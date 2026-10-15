// Backup import/export in SERVER mode: imports must reach the server adapter
// (store.setState alone would never persist), be idempotent, and never touch the local keys.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "./journal";
import type { TradePlan } from "./tradePlan";

vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
  } as Storage;
});

const trade = (id: string, o: Partial<Trade> = {}): Trade => ({
  id, symbol: "XAUUSD", direction: "buy", size: 0.1, entryPrice: 4000, exitPrice: 4010, result: 100,
  entryAt: "2026-07-14T14:20:00", source: "manual", createdAt: "2026-07-14T14:30:00.000Z", ...o,
});
const plan = (id: string): TradePlan => ({
  id, symbol: "XAUUSD", direction: "buy", thesisMacro: "", thesisTechnical: "", timeframe: "", targets: [], catalysts: "",
  status: "draft", createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T08:00:00.000Z", review: { lesson: "" },
});
const FILE_TRADES = Array.from({ length: 67 }, (_, i) => trade(`F${String(i).padStart(2, "0")}`, { result: i % 2 ? -10.5 : 20.25, entryAt: `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00` }));
const file = (extra: object = {}) => JSON.stringify({
  header: { format: "abdel-khader-track-record", formatVersion: 2, exportedAt: "2026-10-01T00:00:00.000Z", appVersion: "0.1.0", tradeCount: 67, totalNetPnl: FILE_TRADES.reduce((s, t) => s + t.result, 0) },
  data: { trades: FILE_TRADES, setups: [{ id: "s1", name: "Breakout" }], baseCapital: 43000, pricesHidden: true, tradePlans: { schemaVersion: 1, plans: [plan("FP1")] }, ...extra },
});
const LEGACY = JSON.stringify({ state: { trades: [trade("L1")], setups: [], baseCapital: 43000, pricesHidden: true }, version: 0 });

async function fresh() {
  vi.resetModules();
  (await import("@/lib/userData/backend")).setBackendForTests("server");
  const runtime = await import("@/lib/userData/runtime");
  const auth = (await import("@/store/authStore")).useAuth;
  const journal = (await import("@/store/journalStore")).useJournal;
  const plans = (await import("@/store/tradePlanStore")).useTradePlans;
  const sync = await import("@/lib/userData/sync");
  const backup = await import("./journalBackup");
  const { MemoryAdapter } = await import("@/lib/userData/memoryAdapter");
  const a = new MemoryAdapter();
  runtime.setAdapterForTests(a);
  auth.setState({ status: "signedIn", session: { user: { id: "A" } } as never, email: "a@x" });
  await settle();
  return { journal, plans, sync, backup, a, auth };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
beforeEach(() => localStorage.clear());

describe("backup import in server mode", () => {
  it("Merge writes to the server adapter, re-checks, and is idempotent", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY);
    const { journal, plans, backup, a } = await fresh();
    const parsed = backup.parseBackup(file());
    if (!parsed.ok) throw new Error(parsed.error);

    const r = await backup.applyImport(parsed.backup, "merge", { copyBaseCapital: true });
    expect(a.calls.filter((c) => c.op === "importMissing")).toHaveLength(1);       // a REAL server write
    expect(a.trades).toHaveLength(67);                                              // persisted server-side, not only in the store
    expect(a.plans.map((p) => p.id)).toEqual(["FP1"]);
    expect(a.setups).toHaveLength(1);
    expect(a.baseCapital).toBe(43000);
    expect(r).toMatchObject({ mode: "merge", added: 67, skipped: 0, after: 67 });
    expect(r.check?.ok).toBe(true);
    expect(journal.getState().trades).toHaveLength(67);                             // store refreshed from the re-read
    expect(plans.getState().plans).toHaveLength(1);
    expect(journal.getState().baseCapital).toBe(43000);
    expect(localStorage.getItem("bbterminal-journal")).toBe(LEGACY);                // legacy local data untouched

    const again = await backup.applyImport(parsed.backup, "merge", { copyBaseCapital: true });
    expect(again).toMatchObject({ added: 0, skipped: 67, after: 67 });
    expect(a.trades).toHaveLength(67);
  });

  it("base capital from the file is NOT applied unless asked, and never overwrites", async () => {
    const { backup, a } = await fresh();
    const p = backup.parseBackup(file());
    if (!p.ok) throw new Error(p.error);
    await backup.applyImport(p.backup, "merge", { copyBaseCapital: false });
    expect(a.baseCapital).toBeNull();
    a.baseCapital = 9000;
    await backup.applyImport(p.backup, "merge", { copyBaseCapital: true });
    expect(a.baseCapital).toBe(9000);
  });

  it("Replace is refused for server accounts and writes nothing", async () => {
    const { backup, a, journal } = await fresh();
    const p = backup.parseBackup(file());
    if (!p.ok) throw new Error(p.error);
    await expect(backup.applyImport(p.backup, "replace")).rejects.toThrow(/Replace is disabled/);
    expect(() => backup.applyReplace(p.backup)).toThrow(/not available for server accounts/);
    expect(() => backup.applyMerge(p.backup)).toThrow();     // the setState-based path can never silently "succeed" without persisting
    expect(a.writes()).toHaveLength(0);
    expect(journal.getState().trades).toHaveLength(0);
  });

  it("is blocked while offline, while saves are pending, or before the account is loaded", async () => {
    const { backup, sync, a } = await fresh();
    const p = backup.parseBackup(file());
    if (!p.ok) throw new Error(p.error);
    sync.setOffline(true);
    await expect(backup.applyImport(p.backup, "merge")).rejects.toThrow(/offline/);
    sync.setOffline(false);
    sync.useSync.setState({ pending: 1 });
    await expect(backup.applyImport(p.backup, "merge")).rejects.toThrow(/still being saved/);
    sync.useSync.setState({ pending: 0 });
    expect(a.calls.filter((c) => c.op === "importMissing")).toHaveLength(0);
  });

  it("a server failure leaves the stores as they were and can be re-run safely", async () => {
    const { backup, a, journal } = await fresh();
    const p = backup.parseBackup(file());
    if (!p.ok) throw new Error(p.error);
    a.failNext.add("importMissing");
    await expect(backup.applyImport(p.backup, "merge")).rejects.toThrow(/simulated/);
    expect(journal.getState().trades).toHaveLength(0);
    const r = await backup.applyImport(p.backup, "merge");
    expect(r.added).toBe(67);
    expect(a.trades).toHaveLength(67);
  });

  it("an account with no base capital exports baseCapital:null and that file parses back", async () => {
    const { backup, journal } = await fresh();
    expect(journal.getState().baseCapital).toBeNull();
    const text = JSON.stringify(backup.buildBackup());
    const p = backup.parseBackup(text);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.backup.data.baseCapital).toBeNull();
    expect(backup.parseBackup(file({ baseCapital: 0 })).ok).toBe(false); // still rejects nonsense
  });
});
