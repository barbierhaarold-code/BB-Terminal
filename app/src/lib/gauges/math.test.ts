import { describe, expect, it } from "vitest";
import { changeOver, cleanBars, maybeIntraday, movesVsUsd, percentileRank, strengthBoard, strengthFromMoves, trailingWindow, volReading } from "./math";
import { CURRENCIES, PAIRS } from "./config";
import type { Bar } from "./types";

const dayAfter = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const series = (start: string, closes: number[]): Bar[] => closes.map((close, i) => ({ date: dayAfter(start, i), close }));
const DEF = { id: "VIX", label: "VIX", measures: "test" };

describe("cleanBars", () => {
  it("sorts, de-duplicates (last wins) and drops non-finite, zero, negative and malformed rows", () => {
    expect(cleanBars([{ date: "2026-01-03", close: 3 }, { date: "2026-01-01", close: 1 }, { date: "2026-01-01", close: 1.5 }, { date: "2026-01-02", close: NaN }, { date: "2026-01-04", close: 0 }, { date: "2026-01-05", close: -2 }, { date: "bad", close: 9 }]))
      .toEqual([{ date: "2026-01-01", close: 1.5 }, { date: "2026-01-03", close: 3 }]);
  });
});

describe("percentileRank (share of window closes ≤ x, x included)", () => {
  it("hand-computed values", () => {
    const w = [10, 20, 30, 40, 50];
    expect(percentileRank(w, 30)).toBe(60);
    expect(percentileRank(w, 50)).toBe(100);
    expect(percentileRank(w, 10)).toBe(20);
    expect(percentileRank(w, 5)).toBe(0);
    expect(percentileRank([7, 7, 7, 7], 7)).toBe(100);   // ties count as "at or below"
    expect(percentileRank([], 1)).toBeNull();
  });
});

describe("changeOver", () => {
  const bars = series("2026-01-01", [10, 11, 12, 13, 15, 18]);
  it("difference in points and percent versus n bars earlier", () => {
    expect(changeOver(bars, 1)).toEqual({ points: 3, pct: (18 / 15 - 1) * 100, from: "2026-01-05" });
    expect(changeOver(bars, 5)).toEqual({ points: 8, pct: 80, from: "2026-01-01" });
  });
  it("null when the history is too short", () => {
    expect(changeOver(bars, 6)).toBeNull();
    expect(changeOver([], 1)).toBeNull();
  });
});

describe("trailingWindow and volReading", () => {
  const long = series("2020-01-01", Array.from({ length: 2200 }, (_, i) => 10 + (i % 50)));   // ~6 years, calendar days
  it("window starts strictly after (last − N days), includes the last bar", () => {
    const w = trailingWindow(long, 365);
    expect(w.closes.length).toBe(365);
    expect(w.covered).toBe(true);
  });
  it("reports level, as-of date, changes and both percentiles from the closes", () => {
    const bars = series("2020-01-01", Array.from({ length: 2200 }, (_, i) => i)); // strictly rising → latest is the maximum
    const r = volReading(DEF, bars);
    if ("error" in r) throw new Error(r.error);
    expect(r).toMatchObject({ level: 2199, asOf: dayAfter("2020-01-01", 2199), pctile1y: 100, pctile5y: 100, n1y: 365, n5y: 1826 });
    expect(r.change1d).toMatchObject({ points: 1, from: dayAfter("2020-01-01", 2198) });
    expect(r.change5d?.points).toBe(5);
    expect(r.warnings).toEqual([]);
  });
  it("percentile of a mid value: latest close ranks among its own window, hand-checked", () => {
    // 1-year window = last 365 closes. closes 0..364 repeated shape: latest = 100 → 101 of 365 values are ≤ 100 (0..100)
    const bars = series("2025-01-01", Array.from({ length: 800 }, (_, i) => (i < 799 ? i % 365 : 100)));
    const r = volReading(DEF, bars);
    if ("error" in r) throw new Error(r.error);
    const w = trailingWindow(cleanBars(bars), 365).closes;
    expect(r.pctile1y).toBe((w.filter((v) => v <= 100).length / w.length) * 100);
  });
  it("history shorter than a window → that percentile is null and a warning says why (never a partial-window number)", () => {
    const r = volReading(DEF, series("2026-01-01", Array.from({ length: 200 }, (_, i) => 15 + (i % 7))));
    if ("error" in r) throw new Error(r.error);
    expect(r.pctile1y).toBeNull();
    expect(r.pctile5y).toBeNull();
    expect(r.warnings).toHaveLength(2);
    expect(r.level).toBeGreaterThan(0);
  });
  it("one bar: level shown, no changes; no bars: an error", () => {
    const r = volReading(DEF, series("2026-10-01", [20]));
    if ("error" in r) throw new Error(r.error);
    expect(r.change1d).toBeNull();
    expect(r.change5d).toBeNull();
    expect("error" in volReading(DEF, [{ date: "2026-10-01", close: NaN }])).toBe(true);
  });
});

describe("currency strength", () => {
  // Hand example over the same window: EURUSD 1.00→1.10, AUDUSD 1.00→0.90, USDJPY 100→110, the others flat.
  const L = (x: number) => Math.log(x);
  const xEUR = L(1.1), xAUD = L(0.9), xJPY = -L(1.1);
  const board = (overrides: Record<string, [number, number]> = {}, n = 30) => {
    const start: Record<string, number> = { EURUSD: 1, GBPUSD: 1, AUDUSD: 1, NZDUSD: 1, USDJPY: 100, USDCAD: 1, USDCHF: 1 };
    const end: Record<string, number> = { ...start, EURUSD: 1.1, AUDUSD: 0.9, USDJPY: 110 };
    const out: Record<string, Bar[]> = {};
    for (const id of Object.keys(start)) {
      const [s, e] = overrides[id] ?? [start[id], end[id]];
      out[id] = series("2026-09-01", Array.from({ length: n }, (_, i) => (i === n - 1 ? e : s)));
    }
    return out;
  };
  const val = (b: ReturnType<typeof strengthBoard>, lb: number, c: string) => b.results.find((r) => r.lookback === lb)!.rows.find((r) => r.currency === c)!;

  it("moves vs USD: pair direction handled (USD-base pairs flip sign)", () => {
    const x = movesVsUsd({ EURUSD: 0.1, USDJPY: 0.05, USDCHF: -0.02 });
    expect(x).toMatchObject({ EUR: 0.1, JPY: -0.05, CHF: 0.02, USD: 0, GBP: null });
  });
  it("matches the hand computation for EUR, AUD and USD (mean of x(c) − x(d) over the 7 others)", () => {
    const b = strengthBoard(board());
    const mean = (xEUR + xAUD + xJPY) / 8;
    expect(val(b, 1, "EUR").value).toBeCloseTo(((xEUR - mean) * 8 / 7) * 100, 9);
    expect(val(b, 1, "EUR").value).toBeCloseTo(12.398, 2);        // 12.40 %
    expect(val(b, 1, "AUD").value).toBeCloseTo(-10.536, 2);       // −10.54 %
    expect(val(b, 1, "USD").value).toBeCloseTo(1.505, 2);         // 1.51 %
    expect(val(b, 1, "JPY").value).toBeCloseTo(((xJPY - mean) * 8 / 7) * 100, 9);
  });
  it("the average of all eight strengths is zero (a relative measure) and ranks follow the values, ties by code", () => {
    const b = strengthBoard(board());
    const r = b.results[0].rows;
    expect(r.reduce((a, x) => a + (x.value as number), 0)).toBeCloseTo(0, 9);
    expect(r.filter((x) => x.rank === 1)[0].currency).toBe("EUR");
    expect(val(b, 1, "AUD").rank).toBe(8);
    // USD, GBP, NZD, CAD and CHF did not move against USD, so they tie at +1.51 % and are ordered by code
    const tied = ["CAD", "CHF", "GBP", "NZD", "USD"].map((c) => val(b, 1, c));
    expect(tied.map((x) => [x.currency, x.rank])).toEqual([["CAD", 2], ["CHF", 3], ["GBP", 4], ["NZD", 5], ["USD", 6]]);
    expect(new Set(tied.map((x) => x.value!.toFixed(9))).size).toBe(1);
    expect([val(b, 1, "JPY").rank, val(b, 1, "AUD").rank]).toEqual([7, 8]);
  });
  it("the three lookbacks use the common trading calendar: 20 days back needs 21 common dates", () => {
    const full = strengthBoard(board());
    expect(full.results.map((r) => [r.lookback, r.to, r.from])).toEqual([[1, "2026-09-30", "2026-09-29"], [5, "2026-09-30", "2026-09-25"], [20, "2026-09-30", "2026-09-10"]]);
    const short = strengthBoard(board({}, 10));
    expect(val(short, 20, "EUR").value).toBeNull();
    expect(val(short, 5, "EUR").value).not.toBeNull();
  });
  it("a missing pair: that currency is n/a, the others are averaged over the currencies that are known", () => {
    const s = board(); delete s.NZDUSD;
    const b = strengthBoard(s);
    expect(b.pairsLeftOut).toEqual([{ id: "NZDUSD", why: "no usable daily closes" }]);
    expect(val(b, 1, "NZD")).toMatchObject({ value: null, rank: null });
    const x = { EUR: xEUR, AUD: xAUD, JPY: xJPY, GBP: 0, CAD: 0, CHF: 0, USD: 0 };
    const others = ["GBP", "AUD", "JPY", "CAD", "CHF", "USD"] as const;
    expect(val(b, 1, "EUR").value).toBeCloseTo((others.reduce((a, d) => a + (xEUR - x[d]), 0) / 6) * 100, 9);
  });
  it("a stale pair (older than the newest by more than a day) is left out and named", () => {
    const s = board();
    s.GBPUSD = s.GBPUSD.slice(0, -5);
    const b = strengthBoard(s);
    expect(b.pairsUsed).not.toContain("GBPUSD");
    expect(b.pairsLeftOut[0]).toMatchObject({ id: "GBPUSD" });
    expect(b.pairsLeftOut[0].why).toMatch(/older than the newest/);
  });
  it("dates missing in one pair shrink the common calendar instead of misaligning windows", () => {
    const s = board();
    s.EURUSD = s.EURUSD.filter((b) => b.date !== "2026-09-29");
    const b = strengthBoard(s);
    expect(b.results[0].from).toBe("2026-09-28");     // 1-day window now spans 28 → 30 Sep for every pair
    expect(b.commonDates).toBe(29);
  });
  it("no data at all → every value null, no throw", () => {
    const b = strengthBoard({});
    expect(b.pairsUsed).toEqual([]);
    expect(b.results.every((r) => r.rows.every((x) => x.value === null))).toBe(true);
    expect(b.asOf).toBeNull();
  });
  it("sanity on the definitions: seven USD pairs, eight currencies", () => {
    expect(PAIRS).toHaveLength(7);
    expect(CURRENCIES).toHaveLength(8);
    expect(strengthFromMoves(movesVsUsd({}))).toMatchObject({ USD: null }); // nothing known beyond USD itself: no others → null
  });
});

describe("maybeIntraday", () => {
  it("flags a latest bar dated today (UTC) as possibly intraday; earlier bars are closes", () => {
    const now = Date.parse("2026-10-09T15:30:00Z");
    expect(maybeIntraday("2026-10-09", now)).toBe(true);
    expect(maybeIntraday("2026-10-08", now)).toBe(false);
  });
});
