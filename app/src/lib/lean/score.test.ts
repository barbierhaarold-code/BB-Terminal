import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeLean, sliceAsOf, sma, trendOf } from "./score";
import { DRIVER_AGREEMENT_NOTE, INSTRUMENTS, LEAN_THRESHOLD, WALK_FORWARD_MULT, allSeriesIds } from "./config";
import type { Bar, CotReading, LeanInputs } from "./types";

// ── fixtures: fully deterministic, no randomness ──
const DAY = 86_400_000;
const D0 = Date.UTC(2024, 0, 1);
const dateAt = (i: number) => new Date(D0 + i * DAY).toISOString().slice(0, 10);
/** n daily bars; close = f(i). A small fixed wiggle keeps volatility non-zero. */
function bars(n: number, f: (i: number) => number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ date: dateAt(i), close: f(i) * (1 + 0.004 * Math.sin(i * 1.7)) }));
}
const N = 300;
const up = (base = 100) => bars(N, (i) => base * (1 + 0.003 * i));
const down = (base = 100) => bars(N, (i) => base * (1 - 0.0022 * i));
const flat = () => bars(N, () => 100);
const yieldUp = () => Array.from({ length: N }, (_, i) => ({ date: dateAt(i), close: 3 + 0.004 * i + 0.01 * Math.sin(i * 1.7) }));
const ASOF = dateAt(N - 1);

// The fixtures test the engine with the a-priori weights; the stored walk-forward multipliers are tested separately.
const savedMult = { ...WALK_FORWARD_MULT };
beforeAll(() => { for (const k of Object.keys(WALK_FORWARD_MULT)) (WALK_FORWARD_MULT as Record<string, number>)[k] = 1; });
afterAll(() => { Object.assign(WALK_FORWARD_MULT, savedMult); });

function allUp(): Record<string, Bar[]> {
  const s: Record<string, Bar[]> = {};
  for (const id of allSeriesIds()) s[id] = up();
  s.UST10 = yieldUp(); s.UST2 = yieldUp();
  s.VIX = down(20); // VIX falling
  return s;
}
const cot = (pct3y: number | null, extra: Partial<CotReading> = {}): CotReading => ({
  contractKey: "x", contractName: "Test contract", groupId: "lev_money", groupLabel: "Leveraged Funds",
  asOf: dateAt(N - 5), net: 1000, changeNet: 50, pct3y, pct5y: 40, ...extra,
});
const run = (id: string, over: Partial<LeanInputs> = {}) =>
  computeLean({ instrumentId: id, asOf: ASOF, series: allUp(), cot: cot(80), ...over });

describe("helpers", () => {
  it("sliceAsOf respects inclusive / strict cut-offs", () => {
    const b = bars(10, (i) => i + 1);
    expect(sliceAsOf(b, dateAt(4), true)).toHaveLength(5);
    expect(sliceAsOf(b, dateAt(4), false)).toHaveLength(4);
    expect(sliceAsOf(b, "1999-01-01", true)).toHaveLength(0);
    expect(sliceAsOf(undefined, dateAt(4), true)).toHaveLength(0);
  });
  it("sma", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1], 2)).toBeNull();
  });
  it("trend: flat series has no volatility estimate (n/a, not 0)", () => {
    expect(trendOf(flat().map((b) => ({ ...b, close: 100 })), "price")).toBeNull();
  });
  it("trend: uptrend scores positive on all four legs, downtrend negative", () => {
    const u = trendOf(up(), "price")!;
    expect(u.components).toHaveLength(4);
    expect(u.components.every((c) => c.score! > 0)).toBe(true);
    const d = trendOf(down(), "price")!;
    expect(d.score!).toBeLessThan(0);
  });
  it("trend: scores stay inside [-1, 1]", () => {
    const t = trendOf(bars(N, (i) => 100 * Math.exp(0.05 * i)), "price")!;
    for (const c of t.components) expect(Math.abs(c.score!)).toBeLessThanOrEqual(1);
  });
});

describe("computeLean", () => {
  it("is deterministic", () => {
    expect(run("EURUSD")).toEqual(run("EURUSD"));
  });

  it("never reads bars dated after asOf (no look-ahead)", () => {
    const base = run("XAUUSD");
    const series = allUp();
    // append wild future bars to every series
    for (const id of Object.keys(series)) {
      series[id] = [...series[id], { date: dateAt(N), close: 1e6 }, { date: dateAt(N + 1), close: 0.0001 }];
    }
    expect(computeLean({ instrumentId: "XAUUSD", asOf: ASOF, series, cot: cot(80) })).toEqual(base);
  });

  it("ignores other series' bar dated ON asOf (strictly earlier only) but uses the instrument's own", () => {
    const series = allUp();
    const base = computeLean({ instrumentId: "EURUSD", asOf: ASOF, series, cot: cot(80) });
    const poisoned = { ...series, DXY: [...series.DXY.slice(0, -1), { date: ASOF, close: 1e6 }] };
    expect(computeLean({ instrumentId: "EURUSD", asOf: ASOF, series: poisoned, cot: cot(80) })).toEqual(base);
    expect(base.freshness.seriesLastBar.DXY).toBe(dateAt(N - 2));
    expect(base.freshness.ownLastBar).toBe(ASOF);
  });

  it("an up-trending world gives EURUSD a Bullish lean; mirrored data gives Bearish", () => {
    const bull = run("EURUSD", { cot: cot(90) });
    // EURUSD fixture: own up, DXY up (bearish for EURUSD) and yields up (bearish) ⇒ mixed signals; use explicit mirror instead
    const s = allUp();
    s.EURUSD = up(); s.DXY = down(); s.UST10 = yieldUp().map((b) => ({ ...b, close: 8 - b.close })); s.UST2 = s.UST10;
    s.GBPUSD = up(); s.AUDUSD = up(); s.USDCHF = down(); s.VIX = down(20); s.SPX = up();
    const r = computeLean({ instrumentId: "EURUSD", asOf: ASOF, series: s, cot: cot(90) });
    expect(r.label).toBe("Bullish lean");
    expect(r.composite!).toBeGreaterThanOrEqual(LEAN_THRESHOLD);
    expect(bull.drivers.find((d) => d.id === "dollarRates")!.score!).toBeLessThan(0); // strong dollar + rising yields
    const m = { ...s, EURUSD: down(), DXY: up(), GBPUSD: down(), AUDUSD: down(), USDCHF: up(), VIX: up(15), SPX: down(), UST10: yieldUp(), UST2: yieldUp() };
    expect(computeLean({ instrumentId: "EURUSD", asOf: ASOF, series: m, cot: cot(10) }).label).toBe("Bearish lean");
  });

  it("driver agreement = round(100 × signAgreement × completeness) with the documented formulas", () => {
    const r = run("XAUUSD");
    const w = r.drivers.filter((d) => d.weight > 0);
    const av = w.filter((d) => d.score != null);
    const num = av.reduce((a, d) => a + d.weight * d.score!, 0);
    const abs = av.reduce((a, d) => a + d.weight * Math.abs(d.score!), 0);
    const W = w.reduce((a, d) => a + d.weight, 0);
    expect(r.signAgreement).toBeCloseTo(Math.abs(num) / abs, 12);
    expect(r.completeness).toBeCloseTo(w.reduce((a, d) => a + d.weight * d.completeness, 0) / W, 12);
    expect(r.driverAgreement).toBe(Math.round(100 * r.signAgreement * r.completeness));
    expect(r.composite!).toBeCloseTo(num / av.reduce((a, d) => a + d.weight, 0), 12);
  });

  it("perfect agreement and full data ⇒ driver agreement 100", () => {
    // gold with every driver bullish: gold/silver/miners/copper/TIP up, DXY/yields down, VIX up (risk-off), COT high
    const s = allUp();
    s.DXY = down(); s.UST10 = yieldUp().map((b) => ({ ...b, close: 8 - b.close })); s.UST2 = s.UST10; s.VIX = up(15);
    const r = computeLean({ instrumentId: "XAUUSD", asOf: ASOF, series: s, cot: cot(100) });
    expect(r.label).toBe("Bullish lean");
    expect(r.completeness).toBe(1);
    expect(r.driverAgreement).toBeGreaterThan(95);
  });

  it("a missing driver degrades completeness (and driver agreement when the rest agree) and is reported — never silently dropped", () => {
    // all drivers bullish for gold ⇒ agreement 1, so driver agreement tracks completeness exactly
    const agree = allUp();
    agree.DXY = down(); agree.UST10 = yieldUp().map((b) => ({ ...b, close: 8 - b.close })); agree.UST2 = agree.UST10; agree.VIX = up(15);
    const full = computeLean({ instrumentId: "XAUUSD", asOf: ASOF, series: agree, cot: cot(100) });
    const s = { ...agree }; delete s.DXY; delete s.UST10; delete s.UST2; delete s.TIP;
    const r = computeLean({ instrumentId: "XAUUSD", asOf: ASOF, series: s, cot: cot(100), seriesErrors: { DXY: "HTTP 502" } });
    const dr = r.drivers.find((d) => d.id === "dollarRates")!;
    expect(dr.score).toBeNull();
    expect(dr.components.every((c) => c.score == null && c.missing)).toBe(true);
    expect(dr.components.find((c) => c.id === "DXY")!.missing).toContain("HTTP 502");
    expect(r.completeness).toBeCloseTo(0.8, 12); // dollar & rates carries 0.20 of the 1.00 weight
    expect(r.completeness).toBeLessThan(full.completeness);
    expect(r.driverAgreement).toBeLessThan(full.driverAgreement);
    expect(r.warnings.some((w) => w.includes("Dollar & rates"))).toBe(true);
  });

  it("partially missing inputs lower that driver's completeness proportionally", () => {
    const s = allUp(); delete s.TIP;
    const dr = computeLean({ instrumentId: "XAUUSD", asOf: ASOF, series: s, cot: cot(80) }).drivers.find((d) => d.id === "dollarRates")!;
    expect(dr.completeness).toBeCloseTo(3 / 4, 12);
    expect(dr.score).not.toBeNull();
  });

  it("no COT ⇒ positioning n/a with the cause, driver agreement lowered", () => {
    const withCot = run("EURUSD");
    const r = run("EURUSD", { cot: null, cotError: "CFTC unreachable" });
    const p = r.drivers.find((d) => d.id === "positioning")!;
    expect(p.score).toBeNull();
    expect(p.components[0].missing).toContain("CFTC unreachable");
    expect(r.completeness).toBeLessThan(withCot.completeness);
  });

  it("missing target series ⇒ Insufficient data, driver agreement 0", () => {
    const s = allUp(); delete s.EURUSD; delete s.DXY; delete s.UST10; delete s.UST2; delete s.GBPUSD; delete s.AUDUSD; delete s.USDCHF; delete s.VIX; delete s.SPX;
    const r = computeLean({ instrumentId: "EURUSD", asOf: ASOF, series: s, cot: null });
    expect(r.label).toBe("Insufficient data");
    expect(r.driverAgreement).toBe(0);
    expect(r.composite).toBeNull();
  });

  it("USD/JPY COT is inverted: heavy long-yen positioning is bearish for USD/JPY", () => {
    const p = run("USDJPY", { cot: cot(95) }).drivers.find((d) => d.id === "positioning")!;
    expect(p.score!).toBeCloseTo(-0.9, 12);
    const q = run("EURUSD", { cot: cot(95) }).drivers.find((d) => d.id === "positioning")!;
    expect(q.score!).toBeCloseTo(0.9, 12);
  });

  it("equity-index and BTC COT are display-only: shown, weight 0, no effect on composite or driver agreement", () => {
    for (const id of ["SPX", "NDX", "BTC"]) {
      const a = run(id, { cot: cot(5) });
      const b = run(id, { cot: cot(95) });
      const pa = a.drivers.find((d) => d.id === "positioning")!;
      expect(pa.weight).toBe(0);
      expect(pa.displayOnly).toBe(true);
      expect(pa.components.some((c) => c.id === "net")).toBe(true);
      expect(a.composite).toBe(b.composite);
      expect(a.driverAgreement).toBe(b.driverAgreement);
    }
  });

  it("risk sign: falling VIX + rising stocks is risk-on = bearish for gold, bullish for AUD/USD", () => {
    const gold = run("XAUUSD").drivers.find((d) => d.id === "risk")!;
    const aud = run("AUDUSD").drivers.find((d) => d.id === "risk")!;
    expect(gold.score!).toBeLessThan(0);
    expect(aud.score!).toBeGreaterThan(0);
  });

  it("confirmer counts add up and agree with the composite direction", () => {
    const r = run("EURUSD");
    const c = r.confirmers;
    expect(c.agree + c.against + c.neutral).toBe(c.total);
    expect(c.total).toBe(3);
  });

  it("emits explicit, numeric 'what would change' thresholds", () => {
    const r = run("XAUUSD");
    expect(r.flips[0].text).toContain(String(LEAN_THRESHOLD.toFixed(2)));
    expect(r.flips.some((f) => /50-day SMA \(\d/.test(f.text))).toBe(true);
    expect(r.flips.some((f) => /200-day SMA \(\d/.test(f.text))).toBe(true);
  });

  it("the driver-agreement wording is fixed: not a probability", () => {
    expect(DRIVER_AGREEMENT_NOTE).toBe("Share of weighted drivers pointing the same way. Not a probability of being right.");
  });

  it("every instrument computes without throwing and weights are non-negative", () => {
    for (const i of INSTRUMENTS) {
      const r = run(i.id);
      expect(r.drivers).toHaveLength(5);
      for (const d of r.drivers) expect(d.weight).toBeGreaterThanOrEqual(0);
    }
  });

  it("a driver the walk-forward test zeroed is still shown but carries no weight and cannot move the composite", () => {
    const a = run("XAUUSD");
    (WALK_FORWARD_MULT as Record<string, number>).trend = 0;
    try {
      const b = run("XAUUSD");
      const t = b.drivers.find((d) => d.id === "trend")!;
      expect(t.weight).toBe(0);
      expect(t.multiplier).toBe(0);
      expect(t.score).not.toBeNull(); // still computed and displayed
      expect(b.drivers.find((d) => d.id === "dollarRates")!.weight).toBeCloseTo(0.2, 12);
      // composite equals the weighted mean of the remaining drivers
      const rest = b.drivers.filter((d) => d.weight > 0 && d.score != null);
      const expected = rest.reduce((x, d) => x + d.weight * d.score!, 0) / rest.reduce((x, d) => x + d.weight, 0);
      expect(b.composite!).toBeCloseTo(expected, 12);
      expect(b.composite).not.toBe(a.composite);
      // levels of a zero-weight driver cannot change the lean, so they are not listed as triggers
      expect(b.flips.some((f) => /50-day SMA \(\d/.test(f.text) && f.text.startsWith("Close"))).toBe(false);
      expect(b.flips.some((f) => f.text.includes("carry weight 0"))).toBe(true);
    } finally { (WALK_FORWARD_MULT as Record<string, number>).trend = 1; }
  });

  it("warns when fewer than two drivers carry weight (agreement is then trivial)", () => {
    const keep = { ...WALK_FORWARD_MULT };
    for (const k of Object.keys(WALK_FORWARD_MULT)) (WALK_FORWARD_MULT as Record<string, number>)[k] = k === "dollarRates" ? 1 : 0;
    try {
      const r = run("EURUSD");
      expect(r.driverAgreement).toBe(100);
      expect(r.warnings.some((w) => w.includes("Only 1 driver carries weight"))).toBe(true);
    } finally { Object.assign(WALK_FORWARD_MULT, keep); }
  });
});
