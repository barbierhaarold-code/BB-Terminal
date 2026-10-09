// The Copilot's journal tools must read only the signed-in user's loaded data, keep working in
// local mode, and never report a load failure / another account's data as the user's journal.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "./journal";

vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; },
  } as Storage;
});

const trade = (id: string, result: number): Trade => ({
  id, symbol: "XAUUSD", direction: "buy", size: 0.1, entryPrice: 4000, exitPrice: 4010, result,
  entryAt: `2026-07-1${id.slice(-1)}T14:20:00`, source: "manual", createdAt: "2026-07-14T14:30:00.000Z",
});
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
type Out = { available?: boolean; reason?: string; stats?: Record<string, unknown>; recentTrades?: { result: number }[]; note?: string };

async function fresh(mode: "local" | "server") {
  vi.resetModules();
  (await import("@/lib/userData/backend")).setBackendForTests(mode);
  const runtime = await import("@/lib/userData/runtime");
  const auth = (await import("@/store/authStore")).useAuth;
  const journal = (await import("@/store/journalStore")).useJournal;
  const { MemoryAdapter } = await import("@/lib/userData/memoryAdapter");
  const { runCopilotTool } = await import("./copilotTools");
  const draft = (await import("@/store/tradeDraftStore")).useTradeDraft;
  const signIn = (id: string | null) => auth.setState(id ? { status: "signedIn", session: { user: { id } } as never, email: `${id}@x` } : { status: "signedOut", session: null, email: null });
  return { runtime, journal, MemoryAdapter, run: runCopilotTool as (n: string, i: Record<string, unknown>) => Promise<Out>, signIn, draft };
}
beforeEach(() => localStorage.clear());

describe("local mode", () => {
  it("get_track_record_stats / get_trade_plans / prefill still work", async () => {
    const { journal, run, draft } = await fresh("local");
    expect(await run("get_track_record_stats", {})).toMatchObject({ available: false, reason: expect.stringMatching(/No trades/) });
    journal.setState({ trades: [trade("t1", 100), trade("t2", -40)] });
    const out = await run("get_track_record_stats", {});
    expect(out.stats).toMatchObject({ count: 2, netProfit: 60, baseCapitalSet: true });
    expect(await run("get_trade_plans", {})).toMatchObject({ available: false });
    await run("prefill_track_record_entry", { direction: "buy", symbol: "xauusd", entryPrice: 4000 });
    expect(draft.getState().draft).toMatchObject({ symbol: "XAUUSD", direction: "buy", entryPrice: "4000" });
    expect(journal.getState().trades).toHaveLength(2); // prefill never writes
  });
});

describe("server mode", () => {
  it("reads only the signed-in user's data; never calls an unloaded/failed journal empty", async () => {
    const { runtime, MemoryAdapter, run, signIn, journal } = await fresh("server");
    expect(await run("get_track_record_stats", {})).toMatchObject({ available: false, reason: expect.stringMatching(/not signed in/) });

    const a = new MemoryAdapter({ trades: [trade("a1", 100), trade("a2", 50)], baseCapital: 1000 });
    runtime.setAdapterForTests(a);
    signIn("A");
    expect(await run("get_track_record_stats", {})).toMatchObject({ available: false, reason: expect.stringMatching(/still loading/) });
    await settle();
    const out = await run("get_track_record_stats", {});
    expect(out.stats).toMatchObject({ count: 2, netProfit: 150, baseCapitalSet: true });

    // sign-out: nothing readable at all
    signIn(null);
    expect(await run("get_track_record_stats", {})).toMatchObject({ available: false, reason: expect.stringMatching(/not signed in/) });

    // account B: sees B only
    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("b1", -5)] }));
    signIn("B"); await settle();
    const b = await run("get_track_record_stats", {});
    expect(b.stats).toMatchObject({ count: 1, netProfit: -5 });
    expect(JSON.stringify(b)).not.toContain("a1");

    // stale data of another owner left in memory is refused, not read
    journal.setState({ ownerId: "A" });
    expect(await run("get_track_record_stats", {})).toMatchObject({ available: false, reason: expect.stringMatching(/not loaded/) });
  });

  it("a load error is reported as an error, not as 'no trades'", async () => {
    const { runtime, MemoryAdapter, run, signIn } = await fresh("server");
    const a = new MemoryAdapter(); a.failNext.add("loadAll");
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    const out = await run("get_track_record_stats", {});
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/could not be loaded.*NOT an empty/);
    expect((await run("get_trade_plans", {})).reason).toMatch(/could not be loaded/);
  });

  it("no base capital: capital-relative figures are null with a note, not 0", async () => {
    const { runtime, MemoryAdapter, run, signIn } = await fresh("server");
    runtime.setAdapterForTests(new MemoryAdapter({ trades: [trade("a1", 100), trade("a2", -30)], baseCapital: null }));
    signIn("A"); await settle();
    const out = await run("get_track_record_stats", {});
    expect(out.stats).toMatchObject({ baseCapitalSet: false, maxDrawdownPct: null, currentDrawdownPct: null, calmar: null, netProfit: 70 });
    expect(out.note).toMatch(/No base capital/);
  });

  it("prefill_track_record_entry still only fills the form and writes nothing to the server", async () => {
    const { runtime, MemoryAdapter, run, signIn, draft } = await fresh("server");
    const a = new MemoryAdapter();
    runtime.setAdapterForTests(a);
    signIn("A"); await settle();
    await run("prefill_track_record_entry", { direction: "sell", symbol: "EURUSD", entryPrice: 1.1, exitPrice: 1.09, size: 1 });
    expect(draft.getState().draft).toMatchObject({ symbol: "EURUSD", direction: "sell" });
    expect(a.writes()).toHaveLength(0);
  });
});
