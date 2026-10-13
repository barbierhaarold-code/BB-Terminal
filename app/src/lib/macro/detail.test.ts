import { describe, expect, it } from "vitest";
import {
  annualised3m, asOf, chartSeries, firstReleases, groupStat, measureReactions, recessionRanges, releaseDayMove, revisionsFor,
  tCrit975, welchDiff, windowStats, type AssetSeries, type VintageRow,
} from "./detail";
import type { Observation } from "./types";

const obs = (pairs: [string, number][]): Observation[] => pairs.map(([period, value]) => ({ period, value }));

describe("chart transformations", () => {
  it("3-month annualised compounds the 3-month change to a yearly rate and needs the exact month 3 back", () => {
    const o = obs([["2026-01", 100], ["2026-02", 100.5], ["2026-04", 101]]);
    const a = annualised3m(o, "monthly");
    expect(a).toHaveLength(1);
    expect(a[0].period).toBe("2026-04");
    expect(a[0].value).toBeCloseTo((Math.pow(1.01, 4) - 1) * 100, 10); // hand-check: 1.01^4 − 1 = 4.0604%
    expect(annualised3m(o, "quarterly")).toEqual([]);
  });
  it("chartSeries 'level' is the series as published; computed transforms never alter it", () => {
    const o = obs([["2025-08", 100], ["2026-07", 103], ["2026-08", 104]]);
    expect(chartSeries(o, "level", "monthly")).toEqual(o);
    expect(chartSeries(o, "yoy", "monthly")[0].value).toBeCloseTo(4, 10);
    expect(chartSeries(o, "diff", "monthly")).toEqual([{ period: "2026-08", value: 1 }]);
  });
});

describe("descriptive statistics", () => {
  const pts = obs([["2016-01", 1], ["2020-01", 5], ["2024-01", 3], ["2026-01", 4]]);
  it("percentile, min/max with dates, mean, z-score over the stated window", () => {
    const all = windowStats(pts, null)!;
    expect(all.window).toBe("All history");
    expect(all.n).toBe(4);
    expect(all.percentile).toBe(75); // 1, 3, 4 ≤ 4
    expect(all.min).toEqual({ period: "2016-01", value: 1 });
    expect(all.max).toEqual({ period: "2020-01", value: 5 });
    expect(all.mean).toBeCloseTo(3.25, 10);
    // sample sd of 1,5,3,4: mean 3.25, squared deviations 5.0625+3.0625+0.0625+0.5625 = 8.75, /3 → 2.9167, sd 1.7078
    expect(all.sd).toBeCloseTo(1.70783, 4);
    expect(all.z).toBeCloseTo((4 - 3.25) / 1.70783, 4);
    const five = windowStats(pts, 5)!;
    expect(five.n).toBe(2); // 2024-01 and 2026-01 end within 5 years of Jan 2026
    expect(five.z).toBeNull();  // fewer than 3 points: no z-score
  });
});

// A tiny ALFRED fixture: Aug was first printed 162, revised to 133 on Oct 2; Sep first printed on Oct 2.
const LEVEL: VintageRow[] = [
  { period: "2026-06", start: "2026-07-03", end: "9999-12-31", value: 1000 },
  { period: "2026-07", start: "2026-08-07", end: "9999-12-31", value: 1100 },
  { period: "2026-08", start: "2026-09-04", end: "2026-10-01", value: 1262 },
  { period: "2026-08", start: "2026-10-02", end: "9999-12-31", value: 1233 },
  { period: "2026-09", start: "2026-10-02", end: "9999-12-31", value: 1262 },
];

describe("ALFRED vintages", () => {
  it("asOf reconstructs the series as known on a date", () => {
    expect(asOf(LEVEL, "2026-09-10").map((o) => o.value)).toEqual([1000, 1100, 1262]);
    expect(asOf(LEVEL, "2026-10-05").map((o) => o.value)).toEqual([1000, 1100, 1233, 1262]);
  });
  it("revisions are tracked in HEADLINE terms (a payroll-style diff), one step per change", () => {
    const r = revisionsFor(LEVEL, "2026-08", "diff", "monthly", 0)!;
    expect(r.steps).toEqual([{ date: "2026-09-04", value: 162 }, { date: "2026-10-02", value: 133 }]);
    expect(r.total).toBe(-29);
  });
  it("first releases carry the previous period's headline AS KNOWN on release day, and drop implausibly late first vintages", () => {
    const fr = firstReleases(LEVEL, "diff", "monthly", 110);
    expect(fr.find((x) => x.period === "2026-09")).toEqual({ period: "2026-09", date: "2026-10-02", value: 29, previous: 133, previousPeriod: "2026-08" });
    expect(fr.find((x) => x.period === "2026-08")).toMatchObject({ date: "2026-09-04", value: 162, previous: 100 });
    const late: VintageRow[] = [{ period: "2001-01", start: "2014-05-01", end: "9999-12-31", value: 1 }, { period: "2001-02", start: "2014-05-01", end: "9999-12-31", value: 2 }];
    expect(firstReleases(late, "none", "monthly", 110)).toEqual([]); // ALFRED coverage that starts years later is not a release date
  });
});

describe("statistics for reaction claims", () => {
  it("t quantiles: exact table points and the normal limit", () => {
    expect(tCrit975(1)).toBe(12.706);
    expect(tCrit975(10)).toBe(2.228);
    expect(tCrit975(500)).toBe(1.96);
    expect(tCrit975(11)).toBeGreaterThan(2.179);
    expect(tCrit975(11)).toBeLessThan(2.228);
  });
  it("groupStat: mean and 95% CI (hand-checked)", () => {
    const g = groupStat([1, 2, 3, 4, 5]);
    // mean 3, sd 1.5811, se 0.7071, t(4) 2.776 → ±1.9629
    expect(g.mean).toBe(3);
    expect(g.ci![0]).toBeCloseTo(3 - 1.9629, 3);
    expect(groupStat([7]).ci).toBeNull();
  });
  it("Welch difference flags 'not significant' when the CI contains zero", () => {
    const sig = welchDiff([5, 6, 7, 5, 6, 7, 5, 6], [0, 1, 0, 1, 0, 1, 0, 1])!;
    expect(sig.estimate).toBeCloseTo(5.375, 10); // 47/8 − 4/8
    expect(sig.significant).toBe(true);
    const ns = welchDiff([1, -1, 2, -2, 0.5, -0.5, 1, -1], [1, -1, 2, -2, 0.4, -0.6, 1, -1])!;
    expect(ns.ci[0]).toBeLessThan(0);
    expect(ns.ci[1]).toBeGreaterThan(0);
    expect(ns.significant).toBe(false);
  });
  it("release-day move: bp for yields, % for levels, previous close at most 5 days back", () => {
    const y: AssetSeries = { id: "y", label: "y", unit: "bp", source: "s", points: new Map([["2026-10-01", 4.0], ["2026-10-02", 4.07]]) };
    const dates = [...y.points.keys()].sort();
    expect(releaseDayMove(y, "2026-10-02", dates)).toBeCloseTo(7, 10);
    const g: AssetSeries = { id: "g", label: "g", unit: "%", source: "s", points: new Map([["2026-09-20", 100], ["2026-10-02", 101]]) };
    expect(releaseDayMove(g, "2026-10-02", [...g.points.keys()].sort())).toBeNull(); // 12-day gap: not a one-day move
  });
  it("measureReactions: groups by direction, excludes ties, refuses a verdict below the minimum group size", () => {
    const rel = [
      { period: "2026-01", date: "2026-02-02", value: 2, previous: 1, previousPeriod: "2025-12" },
      { period: "2026-02", date: "2026-03-02", value: 1, previous: 2, previousPeriod: "2026-01" },
      { period: "2026-03", date: "2026-04-01", value: 1, previous: 1, previousPeriod: "2026-02" },
    ];
    const a: AssetSeries = { id: "y", label: "2Y", unit: "bp", source: "s", points: new Map([["2026-01-30", 4], ["2026-02-02", 4.05], ["2026-02-27", 4], ["2026-03-02", 3.97], ["2026-03-31", 4], ["2026-04-01", 4]]) };
    const m = measureReactions(rel, 1, [a], "2026-01-01");
    expect(m.releases).toBe(2);
    expect(m.unchanged).toBe(1);
    expect(m.assets[0].up.n).toBe(1);
    expect(m.assets[0].down.n).toBe(1);
    expect(m.assets[0].verdict).toBe("insufficient sample");
    expect(m.assets[0].diff).toBeNull();
  });
});

describe("recession shading", () => {
  it("turns 0/1 months into date ranges", () => {
    expect(recessionRanges(obs([["2020-01", 0], ["2020-02", 0], ["2020-03", 1], ["2020-04", 1], ["2020-05", 0]]))).toEqual([["2020-03-01", "2020-04-30"]]);
    expect(recessionRanges(obs([["2026-09", 1]]))).toEqual([["2026-09-01", "2026-09-30"]]);
  });
});
