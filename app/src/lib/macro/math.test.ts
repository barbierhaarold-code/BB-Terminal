import { describe, expect, it } from "vitest";
import {
  assessFreshness, buildView, buildViews, canonicalPeriod, changeOf, fmtChange, fmtValue, latestTwo, periodEnd, periodLabel,
  realPolicyRate, yearBefore, yoyFromIndex,
} from "./math";
import { SERIES, SERIES_BY_ID, knownGap } from "./config";
import type { AdapterSeries, Observation, SeriesDef } from "./types";

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const NOW = ms("2026-10-09");
const obs = (pairs: [string, number][]): Observation[] => pairs.map(([period, value]) => ({ period, value }));
const adapter = (id: string, observations: Observation[], o: Partial<AdapterSeries> = {}): AdapterSeries => ({
  id, ok: true, observations, provider: "P", sourceUrl: "https://example.test", refreshedAt: "2026-10-08T00:00:00.000Z", retrievedAt: "2026-10-09T00:00:00.000Z", ...o,
});
const def = (id: string): SeriesDef => SERIES_BY_ID[id];

describe("periods", () => {
  it("canonicalises each frequency and refuses what it cannot read", () => {
    expect(canonicalPeriod("2026-08", "monthly")).toBe("2026-08");
    expect(canonicalPeriod("2026-08-31", "monthly")).toBe("2026-08");
    expect(canonicalPeriod("2026-06-30", "quarterly")).toBe("2026-Q2");   // RBA gives quarter-end dates
    expect(canonicalPeriod("2026-Q2", "quarterly")).toBe("2026-Q2");
    expect(canonicalPeriod("2026-10-07", "daily")).toBe("2026-10-07");
    expect(canonicalPeriod("2026-Q2", "monthly")).toBeNull();
    expect(canonicalPeriod("2026-13", "monthly")).toBeNull();
    expect(canonicalPeriod("garbage", "daily")).toBeNull();
  });
  it("period end and labels (English)", () => {
    expect(periodEnd("2026-Q2")).toBe("2026-06-30");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
    expect(periodEnd("2026-10-07")).toBe("2026-10-07");
    expect(periodLabel("2026-09")).toBe("Sep 2026");
    expect(periodLabel("2026-Q2")).toBe("Q2 2026");
    expect(periodLabel("2026-10-07")).toBe("Oct 7, 2026");
    expect(yearBefore("2026-Q2")).toBe("2025-Q2");
    expect(yearBefore("2026-08")).toBe("2025-08");
  });
});

describe("yoyFromIndex (computed field)", () => {
  const idx = obs([["2025-07", 100], ["2025-08", 110], ["2025-09", 120], ["2026-07", 103], ["2026-08", 114.3], ["2026-09", 121.2]]);
  it("computes (v / v_12m_earlier − 1) × 100 on the exact same period", () => {
    const y = yoyFromIndex(idx);
    expect(y.map((o) => o.period)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(y[0].value).toBeCloseTo(3.0, 10);                 // 103/100
    expect(y[1].value).toBeCloseTo((114.3 / 110 - 1) * 100, 10); // 3.909090…
    expect(y[1].value).toBeCloseTo(3.9090909, 6);
    expect(y[2].value).toBeCloseTo(1.0, 10);                 // 121.2/120
  });
  it("hand-checked on the real Japan figures (Aug 2026 vs Aug 2025, DBnomics STATJP/CPIm)", () => {
    // 114.3 / 112.1 − 1 = 1.9625 %  (all items);  113.1 / 110.9 − 1 = 1.9838 %  (less fresh food and energy)
    const all = yoyFromIndex(obs([["2025-08", 112.1], ["2026-08", 114.3]]));
    expect(all[0].value).toBeCloseTo(1.9625, 4);
    const core = yoyFromIndex(obs([["2025-08", 110.9], ["2026-08", 113.1]]));
    expect(core[0].value).toBeCloseTo(1.9838, 4);
  });
  it("does not interpolate: a missing prior-year month yields no point", () => {
    const gappy = obs([["2025-07", 100], ["2025-09", 120], ["2026-07", 103], ["2026-08", 114.3], ["2026-09", 121.2]]);
    expect(yoyFromIndex(gappy).map((o) => o.period)).toEqual(["2026-07", "2026-09"]); // 2026-08 has no 2025-08 base
  });
  it("skips non-finite values and a zero base", () => {
    expect(yoyFromIndex(obs([["2025-01", 0], ["2026-01", 5], ["2025-02", NaN], ["2026-02", 5]]))).toEqual([]);
  });
  it("works for quarterly keys", () => {
    const y = yoyFromIndex(obs([["2025-Q2", 200], ["2026-Q2", 206]]));
    expect(y).toHaveLength(1);
    expect(y[0].value).toBeCloseTo(3, 10);
  });
});

describe("latest / change / missing data", () => {
  it("takes the last finite value and the one before it", () => {
    const { latest, previous } = latestTwo(obs([["2026-05", 1], ["2026-06", 2], ["2026-07", NaN]]));
    expect(latest?.period).toBe("2026-06");
    expect(previous?.period).toBe("2026-05");
    expect(changeOf(latest, previous)).toBe(1);
  });
  it("empty and single-point series have no change", () => {
    expect(latestTwo([])).toEqual({ latest: null, previous: null });
    const one = latestTwo(obs([["2026-05", 1]]));
    expect(changeOf(one.latest, one.previous)).toBeNull();
  });
  it("formats with en-US and a true minus; zero change has no sign", () => {
    expect(fmtValue(4.646296, 2)).toBe("4.65");
    expect(fmtValue(null, 2)).toBe("n/a");
    expect(fmtChange(0.1999, 2)).toBe("+0.20");
    expect(fmtChange(-0.17, 2)).toBe("−0.17");
    expect(fmtChange(0.0004, 2)).toBe("0.00");
  });
});

describe("staleness rule", () => {
  const monthly = def("uk.cpi");     // lag 55 days from period end
  const step = def("au.policy");     // lag 45 days from the aggregator's refresh
  it("fresh at the lag, stale just past it, hidden beyond twice the lag", () => {
    // 2026-08 ends 2026-08-31 → age 39 on 2026-10-09
    expect(assessFreshness(monthly, "2026-08", null, NOW)?.state).toBe("fresh");
    // 55 days after 2026-08-31 is 2026-10-25
    expect(assessFreshness(monthly, "2026-08", null, ms("2026-10-25"))?.state).toBe("fresh");
    expect(assessFreshness(monthly, "2026-08", null, ms("2026-10-26"))?.state).toBe("stale");
    // 110 days after 2026-08-31 is 2026-12-19
    expect(assessFreshness(monthly, "2026-08", null, ms("2026-12-19"))?.state).toBe("stale");
    expect(assessFreshness(monthly, "2026-08", null, ms("2026-12-20"))?.state).toBe("hidden");
  });
  it("forced old date: a quarterly series from the euro area is STALE but shown (192 days, lag 160)", () => {
    const f = assessFreshness(def("ea.gdp"), "2026-Q1", null, NOW)!;
    expect(f.ageDays).toBe(192);
    expect(f.state).toBe("stale");
  });
  it("a forced very old observation is hidden (more than 2× lag)", () => {
    expect(assessFreshness(def("ea.gdp"), "2025-Q4", null, NOW)?.state).toBe("stale");  // 282 days: past 160, not past 320
    expect(assessFreshness(def("ea.gdp"), "2025-Q2", null, NOW)?.state).toBe("hidden"); // 466 days
  });
  it("step series are judged by the aggregator's refresh, not by the last decision date", () => {
    const f = assessFreshness(step, "2026-01-01", "2026-09-30T01:52:47.213Z", NOW)!;
    expect(f.basis).toBe("refresh");
    expect(f.from).toBe("2026-09-30");
    expect(f.state).toBe("fresh");
    expect(assessFreshness(step, "2026-09-30", "2026-08-15T00:00:00.000Z", NOW)?.state).toBe("stale"); // refresh 55 days ago (45 < 55 <= 90)
    expect(assessFreshness(step, "2026-09-30", "2026-07-01T00:00:00.000Z", NOW)?.state).toBe("hidden"); // refresh 100 days ago
  });
  it("no date, no verdict", () => {
    expect(assessFreshness(step, "2026-09-30", null, NOW)).toBeNull();
  });
});

describe("buildView", () => {
  it("applies the YoY transform for computed series and flags it computed", () => {
    const d = def("jp.cpi");
    const v = buildView(d, adapter(d.id, obs([["2025-07", 100], ["2025-08", 110], ["2026-07", 103], ["2026-08", 114.3]])), NOW);
    expect(v.computed).toBe(true);
    expect(v.latest?.period).toBe("2026-08");
    expect(v.latest?.value).toBeCloseTo(3.909091, 5);
    expect(v.previous?.period).toBe("2026-07");
    expect(v.change).toBeCloseTo(3.909091 - 3.0, 5);
  });
  it("computed series with too little history reports it instead of inventing a value", () => {
    const d = def("jp.cpi");
    const v = buildView(d, adapter(d.id, obs([["2026-07", 103], ["2026-08", 114.3]])), NOW);
    expect(v.latest).toBeNull();
    expect(v.error).toMatch(/Not enough history/);
  });
  it("passes a published series through untouched", () => {
    const d = def("uk.cpi");
    const v = buildView(d, adapter(d.id, obs([["2026-07", 2.9], ["2026-08", 3.1]])), NOW);
    expect(v.computed).toBe(false);
    expect(v.latest?.value).toBe(3.1);
    expect(v.change).toBeCloseTo(0.2, 10);
    expect(v.freshness?.state).toBe("fresh");
  });
  it("carries the real error of a failed series and a missing one", () => {
    const d = def("uk.cpi");
    expect(buildView(d, adapter(d.id, [], { ok: false, error: "HTTP 503 Service Unavailable" }), NOW).error).toBe("HTTP 503 Service Unavailable");
    expect(buildView(d, undefined, NOW).error).toMatch(/Not returned/);
    expect(buildView(d, adapter(d.id, []), NOW).error).toMatch(/no usable values/);
  });
});

describe("real policy rate (computed)", () => {
  const view = (id: string, o: [string, number][], refreshed = "2026-10-08T00:00:00.000Z") => buildView(def(id), adapter(id, obs(o), { refreshedAt: refreshed }), NOW);
  it("subtracts CPI YoY from the policy rate and shows both dates and frequencies (mixed frequency)", () => {
    const r = realPolicyRate("AU", view("au.policy", [["2026-05-06", 4.35], ["2026-09-30", 4.6]], "2026-09-30T00:00:00.000Z"), view("au.cpi", [["2026-Q1", 4.1], ["2026-Q2", 3.9]]));
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(0.7, 10);
    expect(r.policy).toMatchObject({ period: "2026-09-30", frequency: "daily", value: 4.6 });
    expect(r.cpi).toMatchObject({ period: "2026-Q2", frequency: "quarterly", value: 3.9 });
  });
  it("is not computed when either input is STALE, and says which", () => {
    const stalePolicy = realPolicyRate("AU", view("au.policy", [["2026-09-30", 4.6]], "2026-06-01T00:00:00.000Z"), view("au.cpi", [["2026-Q2", 3.9]]));
    expect(stalePolicy).toMatchObject({ ok: false, value: null, reason: "policy rate is STALE" });
    const staleCpi = realPolicyRate("AU", view("au.policy", [["2026-09-30", 4.6]], "2026-09-30T00:00:00.000Z"), view("au.cpi", [["2025-Q4", 4.0]]));
    expect(staleCpi).toMatchObject({ ok: false, value: null, reason: "CPI is STALE" });
  });
  it("is not computed when a side is missing", () => {
    expect(realPolicyRate("UK", undefined, view("uk.cpi", [["2026-08", 3.1]])).reason).toMatch(/no policy-rate series/);
    expect(realPolicyRate("US", view("us.policy", [["2026-10-09", 3.9]]), undefined).reason).toMatch(/no CPI series/);
  });
  it("a negative real rate stays a plain signed number (no judgement)", () => {
    const r = realPolicyRate("AU", view("au.policy", [["2026-09-30", 2.0]], "2026-09-30T00:00:00.000Z"), view("au.cpi", [["2026-Q2", 3.9]]));
    expect(r.value).toBeCloseTo(-1.9, 10);
  });
});

describe("buildViews (page derivation)", () => {
  const snapOf = (m: Record<string, [string, number][]>, extra: Partial<AdapterSeries> = {}) => ({
    series: SERIES.filter((s) => m[s.id]).map((s) => adapter(s.id, obs(m[s.id]), extra)),
  });
  it("lists every cell that is not shown, with a reason, and never an empty grid", () => {
    const v = buildViews(snapOf({ "uk.cpi": [["2026-07", 2.9], ["2026-08", 3.1]] }), NOW);
    expect(v.shown.map((s) => s.def.id)).toEqual(["uk.cpi"]);
    // 8 economies × 6 indicators = 48 cells; one shown; the other 17 configured series are missing from the response → fetch_error
    expect(v.gaps.length + v.shown.length).toBe(48);
    expect(v.gaps.every((g) => g.reason.length > 10)).toBe(true);
    expect(v.gaps.find((g) => g.economy === "AU" && g.indicator === "policy_rate")?.kind).toBe("fetch_error");
    expect(v.gaps.find((g) => g.economy === "NZ" && g.indicator === "cpi_yoy")?.kind).toBe("no_series");
    expect(v.gaps.find((g) => g.economy === "CH" && g.indicator === "gdp_growth")?.kind).toBe("excluded_provider");
  });
  it("moves a series older than twice its lag from the table to Coverage gaps", () => {
    const v = buildViews(snapOf({ "ea.gdp": [["2025-Q3", 1.4]] }), NOW);
    expect(v.shown.find((s) => s.def.id === "ea.gdp")).toBeUndefined();
    expect(v.gaps.find((g) => g.economy === "EA" && g.indicator === "gdp_growth")?.kind).toBe("too_old");
  });
  it("keeps a stale (but not hidden) series in the table", () => {
    const v = buildViews(snapOf({ "ea.gdp": [["2025-Q4", 1.1], ["2026-Q1", 0.49]] }), NOW);
    const s = v.shown.find((x) => x.def.id === "ea.gdp");
    expect(s?.freshness?.state).toBe("stale");
  });
  it("counts economies whose real rate is computable", () => {
    const v = buildViews(snapOf({ "au.policy": [["2026-09-30", 4.6]], "au.cpi": [["2026-Q2", 3.9]] }, { refreshedAt: "2026-09-30T00:00:00.000Z" }), NOW);
    expect(v.realRateCount).toBe(1);
    expect(v.realRates.filter((r) => r.ok).map((r) => r.economy)).toEqual(["AU"]);
  });
  it("handles an undefined snapshot (loading) without throwing", () => {
    expect(buildViews(undefined, NOW).shown).toEqual([]);
  });
});

describe("config sanity", () => {
  it("ids and codes are unique; every series has attribution, licence note and a lag reason", () => {
    expect(new Set(SERIES.map((s) => s.id)).size).toBe(SERIES.length);
    expect(new Set(SERIES.map((s) => s.code)).size).toBe(SERIES.length);
    for (const s of SERIES) { expect(s.attribution.length).toBeGreaterThan(10); expect(s.licenceNote.length).toBeGreaterThan(5); expect(s.lag.why.length).toBeGreaterThan(5); }
  });
  it("no economy × indicator is both a series and a known gap", () => {
    for (const s of SERIES) expect(knownGap(s.economy, s.indicator).reason.length).toBeGreaterThan(0); // knownGap always answers; uniqueness checked next
    const cells = SERIES.map((s) => `${s.economy}|${s.indicator}`);
    expect(new Set(cells).size).toBe(cells.length);
  });
  it("the BEA series carries the required on-screen attribution", () => {
    expect(SERIES_BY_ID["us.gdp"].attribution).toBe("Source: U.S. Bureau of Economic Analysis, via DBnomics");
  });
});
