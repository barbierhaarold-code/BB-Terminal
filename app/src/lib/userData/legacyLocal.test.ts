import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";

// localStorage that counts every mutation, so "read-only" is provable
vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as unknown as { __ls: Storage; __mut: string[] }).__mut = [];
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { (globalThis as unknown as { __mut: string[] }).__mut.push(`set:${k}`); m.set(k, String(v)); },
    removeItem: (k: string) => { (globalThis as unknown as { __mut: string[] }).__mut.push(`remove:${k}`); m.delete(k); },
    clear: () => { (globalThis as unknown as { __mut: string[] }).__mut.push("clear"); m.clear(); },
    key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
  } as Storage;
});
const muts = (globalThis as unknown as { __mut: string[] }).__mut;

// A journal shaped like the real one: 67 trades, net 30 340.71, base capital 43 000, pricesHidden true, price-0 imports.
const trades: Trade[] = Array.from({ length: 67 }, (_, i) => ({
  id: `L${i}`, symbol: "XAUUSD", direction: i % 2 ? "sell" : "buy", size: 0.3, entryPrice: i % 9 === 0 ? 0 : 4300 + i, exitPrice: i % 9 === 0 ? 0 : 4301 + i,
  result: i === 0 ? 23740.71 : 100, entryAt: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00`,
  source: i % 9 === 0 ? "import" : "manual", createdAt: "2026-07-14T14:30:00.000Z",
}));
const plans: TradePlan[] = [{
  id: "LP1", symbol: "XAUUSD", direction: "buy", thesisMacro: "", thesisTechnical: "", timeframe: "", targets: [], catalysts: "", status: "draft",
  createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T08:00:00.000Z", review: { lesson: "" },
}];
const LEGACY_JOURNAL = JSON.stringify({ state: { trades, setups: [{ id: "s1", name: "Breakout" }], baseCapital: 43000, pricesHidden: true }, version: 0 });
const LEGACY_PLANS = JSON.stringify({ state: { plans }, version: 1 });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { localStorage.clear(); muts.length = 0; });

describe("readLegacyLocal / previewLegacy", () => {
  it("reads the real-shaped data without mutating anything and previews count, net P&L and date range", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY_JOURNAL);
    localStorage.setItem("bbterminal-trade-plans", LEGACY_PLANS);
    muts.length = 0;
    const { readLegacyLocal, previewLegacy } = await import("./legacyLocal");
    const l = readLegacyLocal();
    expect(l).toMatchObject({ present: true, baseCapital: 43000, pricesHidden: true, problems: [] });
    expect(l.trades).toHaveLength(67);
    const pv = previewLegacy(l, { trades: [], setups: [], plans: [] });
    expect(pv.trades).toBe(67);
    expect(pv.netPnl).toBeCloseTo(30340.71, 2);
    expect(pv.from! <= pv.to!).toBe(true);
    expect(pv.plan.batch.trades).toHaveLength(67);
    expect(muts).toEqual([]);                                                        // zero writes/removes
    expect(localStorage.getItem("bbterminal-journal")).toBe(LEGACY_JOURNAL);
    expect(localStorage.getItem("bbterminal-trade-plans")).toBe(LEGACY_PLANS);
  });

  it("preview reports what the account already has as skipped", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY_JOURNAL);
    const { readLegacyLocal, previewLegacy } = await import("./legacyLocal");
    const pv = previewLegacy(readLegacyLocal(), { trades: trades.slice(0, 10), setups: [], plans: [] });
    expect(pv.plan.batch.trades).toHaveLength(57);
    expect(pv.plan.skipped.trades).toBe(10);
  });

  it("nothing local → not present; unreadable local → problems, never throws, never writes", async () => {
    const { readLegacyLocal } = await import("./legacyLocal");
    expect(readLegacyLocal()).toMatchObject({ present: false, problems: [] });
    localStorage.setItem("bbterminal-journal", "{not json");
    muts.length = 0;
    const l = readLegacyLocal();
    expect(l.present).toBe(false);
    expect(l.problems.join(" ")).toMatch(/not valid JSON/);
    expect(muts).toEqual([]);
    expect(localStorage.getItem("bbterminal-journal")).toBe("{not json");
  });
});

describe("explicit local → account import (server mode)", () => {
  async function fresh() {
    vi.resetModules();
    (await import("./backend")).setBackendForTests("server");
    const runtime = await import("./runtime");
    const auth = (await import("@/store/authStore")).useAuth;
    const journal = (await import("@/store/journalStore")).useJournal;
    const plansStore = (await import("@/store/tradePlanStore")).useTradePlans;
    const { MemoryAdapter } = await import("./memoryAdapter");
    const imp = await import("./accountImport");
    const legacy = await import("./legacyLocal");
    const signIn = (id: string | null) => auth.setState(id ? { status: "signedIn", session: { user: { id } } as never, email: `${id}@x` } : { status: "signedOut", session: null, email: null });
    return { runtime, journal, plansStore, MemoryAdapter, imp, legacy, signIn };
  }

  it("is never automatic: signing in with local data present writes nothing and shows only the account's rows", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY_JOURNAL);
    localStorage.setItem("bbterminal-trade-plans", LEGACY_PLANS);
    muts.length = 0; // from here on, count only what the app does
    const { runtime, journal, MemoryAdapter, signIn } = await fresh();
    const a = new MemoryAdapter(); const b = new MemoryAdapter();
    runtime.setAdapterForTests(a); signIn("A"); await settle();
    expect(journal.getState().trades).toEqual([]);
    expect(a.writes()).toHaveLength(0);
    signIn(null);
    runtime.setAdapterForTests(b); signIn("B"); await settle();
    expect(journal.getState().trades).toEqual([]);
    expect(b.writes()).toHaveLength(0);
    expect(muts.filter((m) => m.includes("bbterminal-journal") || m.includes("bbterminal-trade-plans"))).toEqual([]);
  });

  it("imports 67 trades, re-checks count + net P&L, is idempotent, and leaves local data byte-identical", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY_JOURNAL);
    localStorage.setItem("bbterminal-trade-plans", LEGACY_PLANS);
    const { runtime, journal, plansStore, MemoryAdapter, imp, legacy, signIn } = await fresh();
    const a = new MemoryAdapter();
    runtime.setAdapterForTests(a); signIn("A"); await settle();
    muts.length = 0;

    const l = legacy.readLegacyLocal();
    const r1 = await imp.importIntoAccount(legacy.legacyToBatch(l), { copyBaseCapital: l.baseCapital });
    expect(r1.check.ok).toBe(true);
    expect(r1.inserted).toEqual({ setups: 1, trades: 67, plans: 1 });
    expect(a.trades).toHaveLength(67);
    expect(r1.check.actualNet).toBeCloseTo(30340.71, 2);
    expect(journal.getState().trades).toHaveLength(67);
    expect(plansStore.getState().plans).toHaveLength(1);
    expect(journal.getState().baseCapital).toBe(43000);

    const r2 = await imp.importIntoAccount(legacy.legacyToBatch(l));
    expect(r2.inserted).toEqual({ setups: 0, trades: 0, plans: 0 });
    expect(a.trades).toHaveLength(67);

    legacy.writeImportMarker({ account: "A", at: "2026-10-09T00:00:00.000Z", trades: 67, plans: 1 });
    expect(localStorage.getItem("bbterminal-journal")).toBe(LEGACY_JOURNAL);
    expect(localStorage.getItem("bbterminal-trade-plans")).toBe(LEGACY_PLANS);
    // the only localStorage writes during the whole import are our own marker
    expect(muts.filter((m) => m !== `set:${legacy.IMPORT_MARKER_KEY}`)).toEqual([]);
  });

  it("refuses to run unless the account is loaded and online", async () => {
    const { runtime, MemoryAdapter, imp, signIn } = await fresh();
    const a = new MemoryAdapter();
    runtime.setAdapterForTests(a);
    expect(imp.importBlockedReason()).toMatch(/not signed in/);
    signIn("A");                                   // loading, not yet ready
    expect(imp.importBlockedReason()).toMatch(/not loaded/);
    await settle();
    expect(imp.importBlockedReason()).toBeNull();
  });
});
