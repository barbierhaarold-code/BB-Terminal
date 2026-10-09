import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import { computeStats } from "@/lib/journal";
import { MemoryAdapter } from "./memoryAdapter";
import { planImport, runImport } from "./importPlan";

const trade = (id: string, o: Partial<Trade> = {}): Trade => ({
  id, symbol: "XAUUSD", direction: "buy", size: 0.1, entryPrice: 4000, exitPrice: 4010, result: 100,
  entryAt: `2026-07-14T14:${id.slice(-2).padStart(2, "0")}:00`, source: "manual", createdAt: "2026-07-14T14:30:00.000Z", ...o,
});
const plan = (id: string, o: Partial<TradePlan> = {}): TradePlan => ({
  id, symbol: "XAUUSD", direction: "buy", thesisMacro: "", thesisTechnical: "", timeframe: "M15", targets: [4020], catalysts: "",
  status: "active", createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T08:00:00.000Z", review: { lesson: "" }, ...o,
});
// 67-trade fixture shaped like the real journal (incl. price-0 imports)
const many = Array.from({ length: 67 }, (_, i) => trade(`t${String(i).padStart(2, "0")}`, {
  result: i % 3 === 0 ? -50.5 : 120.25, ...(i % 10 === 0 ? { entryPrice: 0, exitPrice: 0, source: "import" as const } : {}),
}));
const incoming = { setups: [{ id: "s1", name: "Breakout" }], trades: many.map((t, i) => (i === 0 ? { ...t, setupId: "s1" } : t)), plans: [plan("p1"), plan("p2", { setupId: "s1" })] };

describe("idempotent import", () => {
  it("first run inserts everything and the re-check matches", async () => {
    const a = new MemoryAdapter();
    const r = await runImport(a, incoming);
    expect(r.inserted).toEqual({ setups: 1, trades: 67, plans: 2 });
    expect(r.check.ok).toBe(true);
    expect(r.after.trades).toHaveLength(67);
    expect(r.check.actualNet).toBeCloseTo(computeStats(many, null).netProfit, 6);
  });

  it("running it a second time adds nothing (no duplicates)", async () => {
    const a = new MemoryAdapter();
    await runImport(a, incoming);
    const again = await runImport(a, incoming);
    expect(again.plan.batch.trades).toHaveLength(0);
    expect(again.inserted).toEqual({ setups: 0, trades: 0, plans: 0 });
    expect(again.plan.skipped).toMatchObject({ trades: 67, plans: 2, setups: 1 });
    expect(a.trades).toHaveLength(67);
    expect(a.plans).toHaveLength(2);
    expect(again.check.ok).toBe(true);
  });

  it("recovers after a partial failure without duplicating", async () => {
    const a = new MemoryAdapter();
    a.failNext.add("importMissing");
    await expect(runImport(a, incoming)).rejects.toThrow(/simulated/);
    expect(a.trades).toHaveLength(0);
    const r = await runImport(a, incoming);
    expect(a.trades).toHaveLength(67);
    expect(r.check.ok).toBe(true);
  });

  it("skips a fill whose id changed but whose signature matches; keeps same-signature rows inside the file", () => {
    const existing = { trades: [trade("old", { entryAt: "2026-02-02T10:00:00" })], setups: [], plans: [] };
    const dupFill = trade("new-id", { entryAt: "2026-02-02T10:00:00" }); // same fill as "old"
    const twoInFile = [trade("x1", { result: 7 }), trade("x2", { result: 7, entryAt: trade("x1").entryAt })];
    const p = planImport(existing, { setups: [], trades: [dupFill, ...twoInFile.map((t) => ({ ...t, entryAt: "2026-01-01T00:00:00" }))], plans: [] });
    expect(p.batch.trades.map((t) => t.id)).toEqual(["x1", "x2"]);
    expect(p.skipped.trades).toBe(1);
  });

  it("matches setups by name and remaps ids on trades and plans", () => {
    const existing = { trades: [], setups: [{ id: "S-existing", name: "breakout" }], plans: [] };
    const p = planImport(existing, { setups: [{ id: "s1", name: "Breakout" }], trades: [trade("a", { setupId: "s1" })], plans: [plan("p", { setupId: "s1" })] });
    expect(p.batch.setups).toHaveLength(0);
    expect(p.batch.trades[0].setupId).toBe("S-existing");
    expect(p.batch.plans[0].setupId).toBe("S-existing");
  });

  it("base capital: set only when the account has none, never overwritten", async () => {
    const a = new MemoryAdapter();
    expect((await runImport(a, incoming, { copyBaseCapital: 43000 })).baseCapital.action).toBe("set");
    expect(a.baseCapital).toBe(43000);
    const b = new MemoryAdapter({ baseCapital: 10000 });
    expect((await runImport(b, incoming, { copyBaseCapital: 43000 })).baseCapital.action).toBe("kept-existing");
    expect(b.baseCapital).toBe(10000);
    const c = new MemoryAdapter();
    await runImport(c, incoming);
    expect(c.baseCapital).toBeNull(); // not requested → account stays without capital
  });

  it("the re-check reports a mismatch loudly", async () => {
    const a = new MemoryAdapter();
    const orig = a.importMissing.bind(a);
    a.importMissing = async (b) => { const c = await orig({ ...b, trades: b.trades.slice(1) }); return { ...c, trades: b.trades.length }; };
    const r = await runImport(a, incoming);
    expect(r.check.ok).toBe(false);
    expect(r.check.problems.join(" ")).toMatch(/trade count/);
  });
});
