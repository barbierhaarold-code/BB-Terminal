import { describe, expect, it } from "vitest";
import { buildViews } from "./math";
import { macroSummary } from "./summary";
import { SERIES } from "./config";
import type { MacroSnapshot } from "./types";

const NOW = Date.parse("2026-10-09T00:00:00Z");
const snap = (): MacroSnapshot => ({
  adapter: "dbnomics", fetchedAt: "2026-10-09T08:00:00.000Z", cacheState: "MISS", warnings: [],
  series: [
    { id: "au.policy", ok: true, observations: [{ period: "2026-05-06", value: 4.35 }, { period: "2026-09-30", value: 4.6 }], provider: "Reserve Bank of Australia", sourceUrl: "x", refreshedAt: "2026-09-30T01:52:47.213Z", retrievedAt: "2026-10-09T08:00:00.000Z" },
    { id: "au.cpi", ok: true, observations: [{ period: "2026-Q1", value: 4.1 }, { period: "2026-Q2", value: 3.9 }], provider: "ABS via RBA", sourceUrl: "x", refreshedAt: "2026-09-30T01:52:47.213Z", retrievedAt: "2026-10-09T08:00:00.000Z" },
    { id: "ea.gdp", ok: true, observations: [{ period: "2025-Q4", value: 1.07 }, { period: "2026-Q1", value: 0.49 }], provider: "ECB", sourceUrl: "x", refreshedAt: "2026-10-04T10:09:05.341Z", retrievedAt: "2026-10-09T08:00:00.000Z" },
  ],
});

describe("macroSummary (Copilot tool payload)", () => {
  const s = snap();
  const out = macroSummary(buildViews(s, NOW), s);
  it("carries dates, provider, STALE flag and attribution per series", () => {
    const au = out.economies.find((e) => e.economy === "Australia")!;
    const cpi = au.series.find((x) => x.indicator === "CPI inflation (YoY)")!;
    expect(cpi).toMatchObject({ latestValue: 3.9, observationPeriod: "Q2 2026", previousValue: 4.1, previousPeriod: "Q1 2026", stale: false });
    expect(cpi.attribution).toMatch(/Australian Bureau of Statistics/);
    const ea = out.economies.find((e) => e.economy === "Euro Area")!;
    expect(ea.series[0]).toMatchObject({ stale: true, ageDays: 192, expectedLagDays: 160 });
  });
  it("computes the real rate only where possible, with its caveat and both dates", () => {
    const au = out.economies.find((e) => e.economy === "Australia")!;
    expect(au.realPolicyRate).toMatchObject({ value: 0.7, policyRate: { observation: "Sep 30, 2026" }, cpiYoY: { observation: "Q2 2026", frequency: "quarterly" } });
    expect((au.realPolicyRate as { caveat: string }).caveat).toMatch(/different frequencies/);
    const us = out.economies.find((e) => e.economy === "United States")!;
    expect(us.realPolicyRate.value).toBeNull();
  });
  it("repeats the rounding note on the two computed Japan series only", () => {
    const j = { ...snap(), series: [
      ...snap().series,
      { id: "jp.cpi", ok: true, observations: [{ period: "2025-08", value: 112.1 }, { period: "2026-08", value: 114.3 }], provider: "SB", sourceUrl: "x", refreshedAt: "2026-09-30T01:53:49.732Z", retrievedAt: "2026-10-09T08:00:00.000Z" },
    ] };
    const o = macroSummary(buildViews(j, NOW), j);
    const jp = o.economies.find((e) => e.economy === "Japan")!.series[0];
    expect(jp.valueNote).toBe("computed · may differ by ±0.1 pp from the official figure (index rounded to 0.1)");
    const au = o.economies.find((e) => e.economy === "Australia")!.series[0];
    expect(au.valueNote).toBeNull();
  });
  it("can focus one economy, lists gaps and states the comparison rule", () => {
    const one = macroSummary(buildViews(s, NOW), s, "NZ");
    expect(one.economies).toHaveLength(1);
    expect(one.economies[0].series).toEqual([]);
    expect(one.coverageGaps).toHaveLength(6);
    expect(out.meta.comparisonViewRule).toMatch(/at least 3 economies qualify; 1 do/);
    expect(SERIES.length).toBe(17);
  });
});
