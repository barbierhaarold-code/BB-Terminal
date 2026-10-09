import { describe, expect, it } from "vitest";
import type { Trade } from "./journal";
import {
  adherenceStats, computeRealizedR, entryReference, mergePlans, normalizeSymbol, parsePlansBlob,
  planProblems, plannedRiskDollars, plannedRMultiples, statusCounts, validatePlan, SMALL_SAMPLE_N, type TradePlan,
} from "./tradePlan";

// ── fixtures (fixed numbers; the three quirk trades mirror the real journal's oddities) ──
const T = (o: Partial<Trade> & { id: string }): Trade => ({
  symbol: "XAUUSD", direction: "buy", size: 0.4, entryPrice: 4000, exitPrice: 4010, result: 400, entryAt: "2026-07-14T14:20:00",
  source: "manual", createdAt: "2026-07-14T14:30:00.000Z", ...o,
});
/** 0.4 lot, +10 move, +400 → money per point per lot = 400 / (10 × 0.4) = 100 */
const goodBuy = T({ id: "good-buy" });
/** sell 4025.7 → 4017.32, 0.4 lot: move = +8.38, result +335.2 → mpp 100 */
const goodSell = T({ id: "good-sell", direction: "sell", entryPrice: 4025.7, exitPrice: 4017.32, result: 335.2 });
/** quirk 1: price 0 / 0 but result +3132.40 (an imported row) */
const price0 = T({ id: "price0", size: 0.3, entryPrice: 0, exitPrice: 0, result: 3132.4, entryAt: "2026-08-07T16:19:00", source: "import" });
/** quirk 2: misspelled symbol, ISO with Z */
const xausd = T({ id: "xausd", symbol: "XAUSD", size: 0.1, entryPrice: 4085.07, exitPrice: 4626.34, result: 4994.22, entryAt: "2026-08-26T10:27:00.000Z" });
/** quirk 3: no timezone suffix (all old trades) */
const noTz = T({ id: "no-tz", entryAt: "2026-07-14T14:20:00" });

const plan = (o: Partial<TradePlan> = {}): TradePlan => ({
  id: "p1", symbol: "XAUUSD", direction: "buy", thesisMacro: "", thesisTechnical: "", timeframe: "M15",
  entryLow: 3995, entryHigh: 4005, stop: 3990, targets: [4020], riskPct: 0.5, catalysts: "", status: "closed",
  createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T08:00:00.000Z", review: { lesson: "" }, ...o,
});

describe("entryReference / risk dollars / problems", () => {
  it("uses the zone midpoint, or the single price", () => {
    expect(entryReference({ entryLow: 3995, entryHigh: 4005 })).toBe(4000);
    expect(entryReference({ entryLow: 4000 })).toBe(4000);
    expect(entryReference({ entryHigh: 4001 })).toBe(4001);
    expect(entryReference({})).toBeUndefined();
  });
  it("planned risk dollars = % × base capital, undefined on bad input", () => {
    expect(plannedRiskDollars(0.5, 43_000)).toBeCloseTo(215, 10);
    expect(plannedRiskDollars(undefined, 43_000)).toBeUndefined();
    expect(plannedRiskDollars(-1, 43_000)).toBeUndefined();
    expect(plannedRiskDollars(1, 0)).toBeUndefined();
  });
  it("flags a stop on the wrong side and a reversed zone", () => {
    expect(planProblems(plan())).toEqual([]);
    expect(planProblems(plan({ stop: 4010 }))[0]).toMatch(/below the entry/);
    expect(planProblems(plan({ direction: "sell", stop: 3990 }))[0]).toMatch(/above the entry/);
    expect(planProblems(plan({ entryLow: 4005, entryHigh: 3995 }))[0]).toMatch(/low is above its high/);
  });
});

describe("computeRealizedR — verified by hand (risk uses the trade's ACTUAL entry)", () => {
  it("hand check from the browser test: sell 0.4 @ 4075.09 → 4066.53, +299.60, plan stop 4085 (zone 4073–4077)", () => {
    // risk/unit = |4075.09 − 4085| = 9.91 ; move = 8.56 ; money/point = 299.6 ÷ (8.56 × 0.4) = 87.5
    // initial risk money = 9.91 × 0.4 × 87.5 = 346.85 ; R = 299.6 ÷ 346.85 = 0.86379…  (= 8.56 ÷ 9.91)
    const p = plan({ direction: "sell", entryLow: 4073, entryHigh: 4077, stop: 4085 });
    const t = T({ id: "browser", direction: "sell", size: 0.4, entryPrice: 4075.09, exitPrice: 4066.53, result: 299.6 });
    const r = computeRealizedR(p, t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plannedRiskPerUnit).toBeCloseTo(9.91, 10);
      expect(r.moneyPerPoint).toBeCloseTo(87.5, 10);
      expect(r.plannedRiskMoney).toBeCloseTo(346.85, 8);
      expect(r.r).toBeCloseTo(0.8638, 4);
      expect(r.r).toBeCloseTo(8.56 / 9.91, 10);
    }
  });
  it("the plan's zone does not matter for R: only the trade's entry and the plan stop", () => {
    const a = computeRealizedR(plan({ entryLow: 3995, entryHigh: 4005 }), goodBuy);
    const b = computeRealizedR(plan({ entryLow: undefined, entryHigh: undefined }), goodBuy);
    expect(a).toEqual(b);
    expect(a.ok && a.r).toBeCloseTo(1, 10);
  });
  it("buy: R = 400 ÷ (|4000−3990| × 0.4 × 100) = 400 ÷ 400 = +1.00 (trade entry 4000)", () => {
    const r = computeRealizedR(plan(), goodBuy);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plannedRiskPerUnit).toBe(10);
      expect(r.moneyPerPoint).toBeCloseTo(100, 10);
      expect(r.plannedRiskMoney).toBeCloseTo(400, 8);
      expect(r.r).toBeCloseTo(1, 10);
    }
  });
  it("sell: stop 4035.7, entry ref 4025.7 → risk 10 → R = 335.2 ÷ 400 = +0.838", () => {
    const r = computeRealizedR(plan({ direction: "sell", entryLow: 4025.7, entryHigh: undefined, stop: 4035.7 }), goodSell);
    expect(r.ok && r.r).toBeCloseTo(0.838, 6);
  });
  it("a losing trade gives a negative R", () => {
    const loser = T({ id: "l", exitPrice: 3990, result: -400 });
    const r = computeRealizedR(plan(), loser);
    expect(r.ok && r.r).toBeCloseTo(-1, 10);
  });
  it("QUIRK price-0 trade (entry 0, exit 0, result +3132.40) NEVER yields a number", () => {
    const r = computeRealizedR(plan({ stop: 3990 }), price0);
    expect(r).toEqual({ ok: false, reason: "trade entry price is 0 or invalid" });
    expect(computeRealizedR(plan({ stop: 3990, entryLow: 0, entryHigh: 0 }), price0).ok).toBe(false);
  });
  it("QUIRK misspelled XAUSD trade still computes (symbol is not an input); numbers decide", () => {
    const r = computeRealizedR(plan({ stop: 4075.07 }), xausd);
    expect(r.ok).toBe(true);
    // mpp = 4994.22 / (541.27 × 0.1) = 92.2…; risk money = 10 × 0.1 × mpp; R = 541.27 / 10 = 54.127
    if (r.ok) expect(r.r).toBeCloseTo(54.127, 6);
  });
  it("QUIRK no-timezone entryAt is irrelevant to the maths", () => {
    expect(computeRealizedR(plan(), noTz).ok).toBe(true);
  });
  it.each([
    ["no stop", plan({ stop: undefined }), goodBuy, /no stop/],
    ["stop equals trade entry", plan({ stop: 4000 }), goodBuy, /stop equals the trade's entry/],
    ["wrong-side stop", plan({ stop: 4010 }), goodBuy, /wrong side/],
    ["direction differs", plan({ direction: "sell", stop: 4010 }), goodBuy, /directions differ/],
    ["size zero", plan(), T({ id: "s0", size: 0 }), /size/],
    ["size NaN", plan(), T({ id: "sn", size: NaN }), /size/],
    ["exit price 0", plan(), T({ id: "x0", exitPrice: 0 }), /exit price/],
    ["result NaN", plan(), T({ id: "rn", result: NaN }), /result/],
    ["entry equals exit", plan(), T({ id: "ee", exitPrice: 4000, result: 0 }), /equals exit/],
    ["sign disagreement", plan(), T({ id: "sd", result: -50 }), /disagree in sign/],
  ])("n/a when %s", (_n, p, t, re) => {
    const r = computeRealizedR(p, t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  });
});

describe("plannedRMultiples (the plan's own zone midpoint)", () => {
  it("buy zone 3995–4005 (ref 4000), stop 3990, targets 4020 / 4040 → 2R / 4R", () => {
    expect(plannedRMultiples(plan({ targets: [4020, 4040] }))).toEqual([2, 4]);
  });
  it("sell: ref 4075, stop 4085, targets 4060 / 4050 → 1.5R / 2.5R", () => {
    const m = plannedRMultiples(plan({ direction: "sell", entryLow: 4073, entryHigh: 4077, stop: 4085, targets: [4060, 4050] }));
    expect(m[0]).toBeCloseTo(1.5, 10);
    expect(m[1]).toBeCloseTo(2.5, 10);
  });
  it("null for a wrong-side target, a missing stop or no zone", () => {
    expect(plannedRMultiples(plan({ targets: [3990, 4020] }))).toEqual([null, 2]);
    expect(plannedRMultiples(plan({ stop: undefined, targets: [4020] }))).toEqual([null]);
    expect(plannedRMultiples(plan({ entryLow: undefined, entryHigh: undefined, targets: [4020] }))).toEqual([null]);
  });
});

describe("title (optional)", () => {
  it("an old stored plan without a title still validates; title is undefined", () => {
    const { title: _t, ...old } = plan({ title: "x" });
    void _t;
    const r = validatePlan(old);
    expect(r.error).toBeUndefined();
    expect(r.plan!.title).toBeUndefined();
  });
  it("keeps a trimmed title and drops a blank or non-string one", () => {
    expect(validatePlan(plan({ title: "  Gold pullback  " })).plan!.title).toBe("Gold pullback");
    expect(validatePlan(plan({ title: "   " })).plan!.title).toBeUndefined();
    expect(validatePlan({ ...plan(), title: 5 }).plan!.title).toBeUndefined();
  });
  it("survives the plans blob", () => {
    const b = parsePlansBlob({ schemaVersion: 1, plans: [plan({ title: "T" }), plan({ id: "q" })] });
    expect(b.ok && b.blob.plans.map((p) => p.title)).toEqual(["T", undefined]);
  });
});

describe("adherenceStats", () => {
  const trades = [goodBuy, price0, xausd];
  const link = (id: string, tradeId: string | undefined, followed?: "yes" | "partly" | "no", o: Partial<TradePlan> = {}) =>
    plan({ id, review: { tradeId, followed, lesson: "" }, ...o });

  it("is empty-safe", () => {
    const a = adherenceStats([], trades);
    expect(a.reviewed).toBe(0);
    expect(a.shares).toBeNull();
    expect(a.note).toBe("No reviewed plans yet.");
  });
  it("counts, shares, net, mean R with sample sizes; price-0 trade adds net but no R", () => {
    const plans = [
      link("a", "good-buy", "yes"),
      link("b", "price0", "yes", { entryLow: 4000, entryHigh: 4000 }),
      link("c", undefined, "no"),
      link("d", "missing-id", "partly"),
      link("e", "xausd", undefined), // not reviewed → excluded
    ];
    const a = adherenceStats(plans, trades);
    expect(a.reviewed).toBe(4);
    expect(a.counts).toEqual({ yes: 2, partly: 1, no: 1 });
    expect(a.shares).toEqual({ yes: 0.5, partly: 0.25, no: 0.25 });
    const yes = a.groups.find((g) => g.followed === "yes")!;
    expect(yes.n).toBe(2);
    expect(yes.linked).toBe(2);
    expect(yes.net).toBeCloseTo(400 + 3132.4, 8);
    expect(yes.rCount).toBe(1); // only the valid trade yields an R
    expect(yes.avgR).toBeCloseTo(1, 10);
    const no = a.groups.find((g) => g.followed === "no")!;
    expect(no.linked).toBe(0);
    expect(no.avgR).toBeNull();
    expect(a.groups.find((g) => g.followed === "partly")!.linked).toBe(0); // dangling id
  });
  it("small-sample note below n=30 and not at n=30", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => link(`p${i}`, undefined, "yes"));
    expect(adherenceStats(mk(SMALL_SAMPLE_N - 1), []).smallSample).toBe(true);
    expect(adherenceStats(mk(5), []).note).toMatch(/Small sample \(n = 5/);
    const big = adherenceStats(mk(SMALL_SAMPLE_N), []);
    expect(big.smallSample).toBe(false);
    expect(big.note).toMatch(/Descriptive figures, not a conclusion/);
  });
  it("status counts", () => {
    expect(statusCounts([plan({ status: "active" }), plan({ id: "x", status: "active" }), plan({ id: "y", status: "draft" })]))
      .toMatchObject({ active: 2, draft: 1, closed: 0 });
  });
});

describe("validation + merge", () => {
  it("normalizeSymbol", () => {
    expect(normalizeSymbol("xau/usd")).toBe("XAUUSD");
    expect(normalizeSymbol("EUR-USD")).toBe("EURUSD");
  });
  it("validatePlan rejects bad shapes and keeps unknown future fields", () => {
    expect(validatePlan({}).error).toMatch(/missing "id"/);
    expect(validatePlan({ ...plan(), direction: "long" }).error).toMatch(/direction/);
    expect(validatePlan({ ...plan(), targets: ["x"] }).error).toMatch(/targets/);
    expect(validatePlan({ ...plan(), status: "nope" }).error).toMatch(/status/);
    expect(validatePlan({ ...plan(), review: { followed: "maybe" } }).error).toMatch(/followed/);
    const ok = validatePlan({ ...plan(), futureField: 7 });
    expect((ok.plan as unknown as { futureField: number }).futureField).toBe(7);
  });
  it("parsePlansBlob: version gate and duplicate ids", () => {
    expect(parsePlansBlob({ schemaVersion: 2, plans: [] })).toMatchObject({ ok: false });
    expect(parsePlansBlob({ schemaVersion: 1, plans: [plan(), plan()] })).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate/) });
    expect(parsePlansBlob({ schemaVersion: 1, plans: [plan()] })).toMatchObject({ ok: true });
  });
  it("mergePlans never removes or edits existing plans, skips same ids, remaps setups", () => {
    const cur = [plan({ id: "a", thesisMacro: "mine" })];
    const incoming = [plan({ id: "a", thesisMacro: "theirs" }), plan({ id: "b", setupId: "s-file" })];
    const m = mergePlans(cur, incoming, new Map([["s-file", "s-local"]]));
    expect(m.added).toBe(1);
    expect(m.skipped).toBe(1);
    expect(m.plans.find((p) => p.id === "a")!.thesisMacro).toBe("mine");
    expect(m.plans.find((p) => p.id === "b")!.setupId).toBe("s-local");
    expect(mergePlans(cur, [], undefined).plans).toEqual(cur);
  });
});
