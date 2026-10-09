// Store behaviour in both backends. Modules are re-imported fresh per test so each
// test controls the backend mode BEFORE the stores are created.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";

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
const plan = (id: string, o: Partial<TradePlan> = {}): TradePlan => ({
  id, symbol: "XAUUSD", direction: "buy", thesisMacro: "m", thesisTechnical: "t", timeframe: "M15", targets: [4020], catalysts: "",
  status: "active", createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T08:00:00.000Z", review: { lesson: "" }, ...o,
});

// The real user's data shape (what the pre-feature app wrote), in the exact serialisation zustand uses.
const LEGACY_TRADES = Array.from({ length: 67 }, (_, i) => trade(`L${i}`, { result: i % 2 ? -10.5 : 20.25 }));
const LEGACY_JOURNAL = JSON.stringify({ state: { trades: LEGACY_TRADES, setups: [{ id: "s1", name: "Breakout" }], baseCapital: 43000, pricesHidden: true }, version: 0 });
const LEGACY_PLANS = JSON.stringify({ state: { plans: [plan("LP1")] }, version: 1 });

async function fresh(mode: "local" | "server") {
  vi.resetModules();
  const backend = await import("./backend");
  backend.setBackendForTests(mode);
  const runtime = await import("./runtime");
  const auth = (await import("@/store/authStore")).useAuth;
  const journal = (await import("@/store/journalStore")).useJournal;
  const plans = (await import("@/store/tradePlanStore")).useTradePlans;
  const sync = await import("./sync");
  const { MemoryAdapter } = await import("./memoryAdapter");
  const signIn = (id: string | null) => auth.setState(id ? { status: "signedIn", session: { user: { id } } as never, email: `${id}@x` } : { status: "signedOut", session: null, email: null });
  return { backend, runtime, auth, journal, plans, sync, MemoryAdapter, signIn };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { localStorage.clear(); });

describe("local backend is unchanged", () => {
  it("hydrating and using the stores leaves the persisted values byte-identical in shape", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY_JOURNAL);
    localStorage.setItem("bbterminal-trade-plans", LEGACY_PLANS);
    const { journal, plans } = await fresh("local");
    expect(journal.getState().trades).toHaveLength(67);
    expect(journal.getState().baseCapital).toBe(43000);
    expect(journal.getState().pricesHidden).toBe(true);
    expect(plans.getState().plans).toHaveLength(1);
    expect(localStorage.getItem("bbterminal-journal")).toBe(LEGACY_JOURNAL);
    expect(localStorage.getItem("bbterminal-trade-plans")).toBe(LEGACY_PLANS);
  });

  it("a local write persists with exactly the old keys and order", async () => {
    const { journal } = await fresh("local");
    journal.getState().addTrade({ symbol: "EURUSD", direction: "buy", size: 1, entryPrice: 1, exitPrice: 2, result: 1, entryAt: "2026-01-01T00:00:00", source: "manual" });
    const stored = JSON.parse(localStorage.getItem("bbterminal-journal")!);
    expect(Object.keys(stored)).toEqual(["state", "version"]);
    expect(Object.keys(stored.state)).toEqual(["trades", "setups", "baseCapital", "pricesHidden"]);
    expect(stored.state.baseCapital).toBe(43000);
    expect(stored.state.trades).toHaveLength(1);
  });

  it("never touches the server adapter or the account reset", async () => {
    const { journal, signIn, runtime, MemoryAdapter } = await fresh("local");
    const a = new MemoryAdapter(); runtime.setAdapterForTests(a);
    signIn("A"); signIn(null);
    journal.getState().addTrade({ symbol: "X", direction: "buy", size: 1, entryPrice: 1, exitPrice: 2, result: 1, entryAt: "2026-01-01T00:00:00", source: "manual" });
    await settle();
    expect(a.calls).toHaveLength(0);
    expect(journal.getState().trades).toHaveLength(1); // sign-out does NOT wipe local mode's memory (it would be written to disk)
  });
});

describe("server backend", () => {
  it("never reads or writes the local journal/plans keys (byte-identical after a full session)", async () => {
    localStorage.setItem("bbterminal-journal", LEGACY_JOURNAL);
    localStorage.setItem("bbterminal-trade-plans", LEGACY_PLANS);
    const { journal, plans, signIn, runtime, MemoryAdapter } = await fresh("server");
    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("S1")], plans: [plan("SP1")], baseCapital: null }));
    signIn("A"); await settle();
    // the account's data, not the local data, is what the stores hold
    expect(journal.getState().trades.map((t) => t.id)).toEqual(["S1"]);
    expect(plans.getState().plans.map((p) => p.id)).toEqual(["SP1"]);
    journal.getState().addTrade({ symbol: "X", direction: "buy", size: 1, entryPrice: 1, exitPrice: 2, result: 1, entryAt: "2026-01-01T00:00:00", source: "manual" });
    journal.getState().setBaseCapital(5000);
    journal.getState().togglePricesHidden();
    plans.getState().updatePlan("SP1", { status: "closed" });
    plans.getState().deletePlan("SP1");
    await settle(); signIn(null); await settle();
    expect(localStorage.getItem("bbterminal-journal")).toBe(LEGACY_JOURNAL);
    expect(localStorage.getItem("bbterminal-trade-plans")).toBe(LEGACY_PLANS);
    expect(Object.keys(Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => [localStorage.key(i)!, 1])))
      .sort()).toEqual(["bbterminal-journal", "bbterminal-prices-hidden", "bbterminal-trade-plans"]);
  });

  it("sign-out empties every store synchronously; the next account never sees the previous one's data", async () => {
    const { journal, plans, signIn, runtime, MemoryAdapter, sync } = await fresh("server");
    // every state each store ever takes, with the owner recorded in that same state (a store is internally consistent)
    const seen: { owner: string | null; ids: string[] }[] = [];
    journal.subscribe((s) => seen.push({ owner: s.ownerId, ids: s.trades.map((t) => t.id) }));
    plans.subscribe((s) => seen.push({ owner: s.ownerId, ids: s.plans.map((p) => p.id) }));

    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("A1"), trade("A2")], plans: [plan("PA")], setups: [{ id: "sa", name: "A setup" }], baseCapital: 1000 }));
    signIn("A"); await settle();
    expect(journal.getState().trades).toHaveLength(2);
    expect(journal.getState().baseCapital).toBe(1000);

    signIn(null);                      // sign-out — NO await: must already be empty
    expect(journal.getState().trades).toEqual([]);
    expect(journal.getState().setups).toEqual([]);
    expect(journal.getState().baseCapital).toBeNull();
    expect(plans.getState().plans).toEqual([]);
    expect(journal.getState().ownerId).toBeNull();
    expect(journal.getState().status).toBe("idle");
    expect(sync.useSync.getState().pending).toBe(0);

    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("B1")], plans: [], baseCapital: null }));
    signIn("B"); await settle();
    expect(journal.getState().trades.map((t) => t.id)).toEqual(["B1"]);
    expect(plans.getState().plans).toEqual([]);

    // across the WHOLE history of both stores, A's rows only ever appear under A, B's only under B
    for (const s of seen) {
      if (s.ids.some((i) => i.startsWith("A") || i === "PA")) expect(s.owner).toBe("A");
      if (s.ids.some((i) => i.startsWith("B"))) expect(s.owner).toBe("B");
    }
  });

  it("switching straight from A to B (no sign-out) also resets first", async () => {
    const { journal, signIn, runtime, MemoryAdapter } = await fresh("server");
    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("A1")] }));
    signIn("A"); await settle();
    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("B1")] }));
    signIn("B");
    expect(journal.getState().trades).toEqual([]);   // synchronously, before B's data arrives
    expect(journal.getState().status).toBe("loading");
    await settle();
    expect(journal.getState().trades.map((t) => t.id)).toEqual(["B1"]);
  });

  it("a slow load for the previous user is dropped when the user changed", async () => {
    const { journal, signIn, runtime, MemoryAdapter } = await fresh("server");
    const slow = new MemoryAdapter({ trades: [trade("A-slow")] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const orig = slow.loadAll.bind(slow);
    slow.loadAll = async () => { await gate; return orig(); };
    runtime.setAdapterForTests(slow);
    signIn("A"); await settle();
    expect(journal.getState().status).toBe("loading");
    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("B1")] }));
    signIn("B"); await settle();
    release(); await settle();
    expect(journal.getState().trades.map((t) => t.id)).toEqual(["B1"]);
    expect(journal.getState().ownerId).toBe("B");
  });

  it("3 states: loading → empty-ready → error with Retry", async () => {
    const { journal, plans, signIn, runtime, MemoryAdapter } = await fresh("server");
    const a = new MemoryAdapter();
    a.failNext.add("loadAll");
    runtime.setAdapterForTests(a);
    signIn("A");
    expect(journal.getState().status).toBe("loading");
    await settle();
    expect(journal.getState()).toMatchObject({ status: "error", trades: [] });
    expect(journal.getState().loadError).toMatch(/simulated failure/);
    expect(plans.getState().status).toBe("error");
    journal.getState().reload(); await settle();
    expect(journal.getState()).toMatchObject({ status: "ready", trades: [], loadError: null });
    expect(plans.getState().status).toBe("ready");
  });

  it("writes are refused (visibly, adapter untouched) before the data is loaded", async () => {
    const { journal, signIn, runtime, MemoryAdapter, sync } = await fresh("server");
    const a = new MemoryAdapter(); a.failNext.add("loadAll");
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    journal.getState().addTrade({ symbol: "X", direction: "buy", size: 1, entryPrice: 1, exitPrice: 2, result: 1, entryAt: "2026-01-01T00:00:00", source: "manual" });
    expect(journal.getState().trades).toEqual([]);
    expect(sync.useSync.getState().saveError?.message).toMatch(/not loaded/);
    expect(a.writes()).toHaveLength(0);
  });

  it("a write goes to the server; a failed save rolls back, shows the error, and Retry re-applies and saves", async () => {
    const { journal, signIn, runtime, MemoryAdapter, sync } = await fresh("server");
    const a = new MemoryAdapter({ trades: [trade("A1")] });
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();

    journal.getState().updateTrade("A1", { notes: "n1" });
    expect(journal.getState().trades[0].notes).toBe("n1");           // optimistic, immediately
    await settle();
    expect(a.trades[0].notes).toBe("n1");                              // and persisted on the server

    a.failNext.add("updateTrade");
    journal.getState().updateTrade("A1", { notes: "will fail" });
    expect(journal.getState().trades[0].notes).toBe("will fail");
    await settle();
    expect(journal.getState().trades[0].notes).toBe("n1");             // rolled back
    const err = sync.useSync.getState().saveError;
    expect(err?.message).toMatch(/Updating trade failed: simulated failure in updateTrade/);
    expect(err?.ops).toHaveLength(1);

    sync.retrySave(); await settle();
    expect(sync.useSync.getState().saveError).toBeNull();
    expect(journal.getState().trades[0].notes).toBe("will fail");
    expect(a.trades[0].notes).toBe("will fail");
  });

  it("a failure rolls back the failed change AND everything queued behind it, in order", async () => {
    const { journal, plans, signIn, runtime, MemoryAdapter, sync } = await fresh("server");
    const a = new MemoryAdapter();
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    a.failNext.add("insertPlan");
    const p = plans.getState().addPlan({ symbol: "XAUUSD", direction: "buy", thesisMacro: "", thesisTechnical: "", timeframe: "", targets: [], catalysts: "", status: "draft", review: { lesson: "" } });
    plans.getState().updatePlan(p.id, { context: undefined, title: "later edit" });
    expect(plans.getState().plans[0].title).toBe("later edit");
    await settle();
    expect(plans.getState().plans).toEqual([]);                        // both undone
    expect(sync.useSync.getState().saveError?.ops).toHaveLength(2);
    expect(a.plans).toHaveLength(0);
    sync.retrySave(); await settle();                                   // re-applied in order: insert then update
    expect(a.plans).toHaveLength(1);
    expect(a.plans[0].title).toBe("later edit");
    expect(a.writes().map((c) => c.op)).toEqual(["insertPlan", "insertPlan", "updatePlan"]);
    void journal;
  });

  it("offline = read-only: nothing is applied or sent, and the message says so", async () => {
    const { journal, signIn, runtime, MemoryAdapter, sync } = await fresh("server");
    const a = new MemoryAdapter({ trades: [trade("A1")] });
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    sync.setOffline(true);
    journal.getState().deleteTrade("A1");
    expect(journal.getState().trades).toHaveLength(1);
    expect(sync.useSync.getState().saveError?.message).toMatch(/offline.*read-only/i);
    expect(a.writes()).toHaveLength(0);
  });

  it("network failure mid-save rolls back (data not silently lost or silently kept)", async () => {
    const { journal, signIn, runtime, MemoryAdapter, sync } = await fresh("server");
    const a = new MemoryAdapter({ trades: [trade("A1")] });
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    a.down = "Failed to fetch";
    journal.getState().deleteTrade("A1");
    expect(journal.getState().trades).toHaveLength(0);
    await settle();
    expect(journal.getState().trades.map((t) => t.id)).toEqual(["A1"]);
    expect(sync.useSync.getState().saveError?.message).toMatch(/Failed to fetch/);
  });

  it("new accounts start with no base capital; pricesHidden is a device preference, not a server write", async () => {
    const { journal, signIn, runtime, MemoryAdapter } = await fresh("server");
    const a = new MemoryAdapter();
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    expect(journal.getState().baseCapital).toBeNull();
    journal.getState().togglePricesHidden();
    await settle();
    expect(journal.getState().pricesHidden).toBe(true);
    expect(localStorage.getItem("bbterminal-prices-hidden")).toBe("1");
    expect(a.writes()).toHaveLength(0);
  });
});
