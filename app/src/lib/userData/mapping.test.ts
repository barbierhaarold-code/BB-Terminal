import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import { planToRow, rowToPlan, rowToSetup, rowToTrade, setupToRow, tradePatchToRow, tradeToRow } from "./mapping";
import { canonicalData, hashData } from "./canonical";

const full: Trade = {
  id: "t-full", symbol: "XAUUSD", direction: "sell", size: 0.3, entryPrice: 4390.64, exitPrice: 4388.52, result: -54.93,
  entryAt: "2026-08-14T17:01:56", exitAt: "2026-08-14T17:30:00", setupId: "s1", macroBias: "Risk-Off", conviction: "Forte",
  newsEvent: "CPI", feeling: "calme", notes: "line1\nline2 é ✓", source: "import", createdAt: "2026-07-14T14:30:00.000Z",
};
const minimal: Trade = { id: "t-min", symbol: "EURUSD", direction: "buy", size: 1, entryPrice: 0, exitPrice: 0, result: 3132.4,
  entryAt: "2026-07-14T14:20", source: "manual", createdAt: "2026-07-14T14:30:00.000Z" };
const emptyStrings: Trade = { ...minimal, id: "t-empty", notes: "", feeling: "", macroBias: "" };
const withExtra = { ...minimal, id: "t-extra", futureField: { a: [1, 2] }, other: "x" } as Trade;

const plan = (o: Partial<TradePlan> = {}): TradePlan => ({
  id: "p1", symbol: "XAUUSD", direction: "buy", thesisMacro: "m", thesisTechnical: "t", timeframe: "M15", targets: [4020, 4030.5],
  catalysts: "", status: "active", createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T09:00:00.000Z", review: { lesson: "" }, ...o,
});

describe("trade mapping", () => {
  it.each([["full", full], ["minimal (price 0)", minimal], ["empty strings kept", emptyStrings], ["unknown fields → extra", withExtra]])(
    "round trips %s", (_n, t) => { expect(rowToTrade(tradeToRow(t))).toEqual(t); });

  it("keeps naive timestamps verbatim (no timezone invented)", () => {
    expect(tradeToRow(full).entry_at).toBe("2026-08-14T17:01:56");
    expect(tradeToRow(full).created_at).toBe("2026-07-14T14:30:00.000Z");
  });
  it("maps absent optionals to null and back without adding keys", () => {
    const r = tradeToRow(minimal);
    expect(r.exit_at).toBeNull();
    expect("exitAt" in rowToTrade(r)).toBe(false);
  });
  it("never puts server-owned columns in a row", () => {
    const keys = Object.keys(tradeToRow(full));
    for (const k of ["user_id", "seq", "row_created_at", "row_updated_at"]) expect(keys).not.toContain(k);
  });
  it("patch → only the patched columns", () => {
    expect(tradePatchToRow({ result: 5, notes: undefined })).toEqual({ result: 5, notes: null });
    expect(tradePatchToRow({ setupId: undefined })).toEqual({ setup_id: null });
  });
});

describe("plan mapping", () => {
  const rich = plan({
    title: "T", setupId: "s1", entryLow: 3995, entryHigh: 4005, stop: 3990, riskPct: 0.5, conviction: 4,
    context: { takenAt: "2026-07-14T08:00:00.000Z", symbol: "XAUUSD", market: { available: false, reason: "r" }, cot: { available: false, reason: "r" }, note: "n" },
    review: { tradeId: "t-full", followed: "partly", lesson: "wait" },
  });
  it.each([["minimal", plan()], ["rich (context, review)", rich], ["no targets", plan({ targets: [] })],
    ["unknown fields → extra", { ...plan(), future: 1 } as TradePlan]])("round trips %s", (_n, p) => {
    expect(rowToPlan(planToRow(p))).toEqual(p);
  });
  it("maps review columns and schema version", () => {
    const r = planToRow(rich);
    expect(r).toMatchObject({ review_trade_id: "t-full", review_followed: "partly", review_lesson: "wait", schema_version: 1 });
  });
});

describe("setup mapping + canonical hash", () => {
  it("round trips a setup", () => { expect(rowToSetup(setupToRow({ id: "s1", name: "Breakout" }))).toEqual({ id: "s1", name: "Breakout" }); });

  it("hash ignores key order and array order, but not values", async () => {
    const a = await hashData({ trades: [full, minimal], setups: [{ id: "s1", name: "B" }], baseCapital: 43000, plans: [plan()] });
    const reordered = { ...full, notes: full.notes, id: full.id } as Trade;
    const shuffledKeys = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as Trade;
    const b = await hashData({ trades: [minimal, shuffledKeys], setups: [{ id: "s1", name: "B" }], baseCapital: 43000, plans: [plan()] });
    expect(b).toBe(a);
    const c = await hashData({ trades: [minimal, { ...full, result: -54.94 }], setups: [{ id: "s1", name: "B" }], baseCapital: 43000, plans: [plan()] });
    expect(c).not.toBe(a);
  });
  it("a server round trip of every trade/plan keeps the canonical form identical", () => {
    const d = { trades: [full, minimal, emptyStrings, withExtra], setups: [], baseCapital: null, plans: [plan()] };
    const back = { ...d, trades: d.trades.map((t) => rowToTrade(tradeToRow(t))), plans: d.plans.map((p) => rowToPlan(planToRow(p))) };
    expect(canonicalData(back)).toBe(canonicalData(d));
  });
});
