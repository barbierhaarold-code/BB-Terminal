import { describe, expect, it } from "vitest";
import { indicatorSummary, resolveIndicator } from "./indicatorTool";
import { ALL_BY_ID } from "./catalog";
import { COPILOT_TOOLS } from "../copilotTools";
import type { MacroDetail } from "./detail";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const detail = (o: Partial<MacroDetail> = {}): MacroDetail => ({
  id: "us.payrolls", fetchedAt: "2026-10-13T00:00:00Z", provider: "U.S. Bureau of Labor Statistics, via FRED", sourceUrl: "https://fred.stlouisfed.org/series/PAYEMS",
  refreshedAt: "2026-10-02T00:00:00.000Z", fredMeta: null,
  history: [{ period: "2026-07", value: 1100 }, { period: "2026-08", value: 1233 }, { period: "2026-09", value: 1262 }],
  release: { name: "Employment Situation", link: null, fredReleaseId: 50, next: "2026-11-06", nextNote: "per FRED" },
  revisions: { available: false, reason: "test" }, reaction: { available: false, reason: "test reason" }, recessions: null, warnings: [], ...o,
});

describe("get_macro_indicator", () => {
  it("is registered, read-only by schema (no write fields) and the tool list stays under the gateway cap", () => {
    const t = COPILOT_TOOLS.find((x) => x.name === "get_macro_indicator")!;
    expect(t).toBeTruthy();
    expect(Object.keys((t.input_schema as { properties: object }).properties)).toEqual(["id", "query", "economy"]);
    expect(t.description).toMatch(/READ-ONLY/);
  });
  it("resolves ids and queries; ambiguous queries return candidates, never a guess", () => {
    expect(resolveIndicator({ id: "us.cpi" })).toMatchObject({ def: { id: "us.cpi" } });
    expect(resolveIndicator({ query: "initial jobless claims" })).toMatchObject({ def: { id: "us.claims" } });
    const claims = resolveIndicator({ query: "jobless claims" }); // initial AND continuing: genuinely ambiguous
    expect("candidates" in claims && claims.candidates.map((c) => c.id).sort()).toEqual(["us.ccl", "us.claims"]);
    expect(resolveIndicator({ query: "core pce" })).toMatchObject({ def: { id: "us.pcecore" } });
    const amb = resolveIndicator({ query: "unemployment" });
    expect("candidates" in amb && amb.candidates.length).toBeGreaterThan(1);
    expect(resolveIndicator({ query: "unemployment", economy: "JP" })).toMatchObject({ def: { id: "jp.unemp" } });
    expect(resolveIndicator({ id: "nope" })).toMatchObject({ error: expect.stringMatching(/Unknown indicator/) });
  });
  it("summarises value, periods, source, next release, explanation id and honest 'not tracked' reasons", () => {
    const s = indicatorSummary(ALL_BY_ID["us.payrolls"], detail(), NOW);
    expect(s.latest).toEqual({ value: 29, observationPeriod: "Sep 2026" });
    expect(s.previous).toEqual({ value: 133, observationPeriod: "Aug 2026" });
    expect(s.change).toBe(-104);
    expect(s.source.seriesId).toBe("FRED PAYEMS");
    expect(s.nextRelease).toMatchObject({ date: "Nov 6, 2026" });
    expect(s.explanationId).toBe("us.payrolls");
    expect(s.revisions).toEqual({ tracked: false, why: "test" });
    expect(s.marketReaction).toEqual({ measured: false, why: "test reason" });
    expect(s.computed).toMatch(/computed/);
  });
});
