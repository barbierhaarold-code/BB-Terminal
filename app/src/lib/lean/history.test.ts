import { describe, expect, it } from "vitest";
import { agreementPhrase, historicalAgreement } from "./history";

const st = (over: object) => ({ n: 14535, hitRate: 0.514, expected: 0.498, edge: 0.016, ...over });

describe("historical agreement wording", () => {
  it("states the number, chance baseline, n and 'not significant' when the interval spans zero", () => {
    const t = agreementPhrase(st({ ci: { edgeLo: -0.036, edgeHi: 0.069, significant: "none" } }));
    expect(t).toBe("51.4% vs 49.8% chance, n=14,535, not significant (95% CI for the edge −3.6 to +6.9 pts)");
  });
  it("flags a significant result as uncorrected for multiple comparisons, and a worse-than-chance one as such", () => {
    expect(agreementPhrase(st({ ci: { edgeLo: 0.01, edgeHi: 0.05, significant: "edge" } }))).toContain("uncorrected for multiple comparisons");
    expect(agreementPhrase(st({ ci: { edgeLo: -0.07, edgeHi: -0.02, significant: "worse" } }))).toContain("WORSE than chance");
  });
  it("handles an instrument with no samples", () => {
    expect(agreementPhrase(undefined)).toBe("no directional samples");
  });
  it("the stored result produces a pooled line plus an instrument line and a never-predictive caveat", () => {
    const h = historicalAgreement("XAUUSD");
    expect(h.text).toContain("13 instruments pooled");
    expect(h.text).toContain("This instrument");
    expect(h.caveat).toContain("does not make the lean predictive");
  });
});
