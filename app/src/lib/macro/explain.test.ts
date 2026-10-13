import { describe, expect, it } from "vitest";
import { ALL_SERIES } from "./catalog";
import { EXPLAIN, GLOSSARY, explanationOf, explainKey } from "./explain";

// Words that would turn descriptive text into a prediction or a trade idea.
const FORBIDDEN = /\b(expect(s|ed)? (a|the|higher|lower|to)|will (rise|fall|go|move)|buy|sell|go long|go short|target price|we recommend|should (buy|sell))\b/i;

describe("static explanations", () => {
  it("every indicator in every catalogue has a complete explanation", () => {
    for (const d of ALL_SERIES) {
      const e = explanationOf(d);
      expect(e, `${d.id} → ${explainKey(d)}`).toBeTruthy();
      for (const f of ["measures", "construction", "schedule", "whyMarkets"] as const) expect(e![f].length, `${d.id}.${f}`).toBeGreaterThan(30);
      for (const f of ["currency", "rates", "equities", "gold"] as const) expect(e!.interpretation[f].length, `${d.id}.interpretation.${f}`).toBeGreaterThan(15);
      expect(e!.pitfalls.length, `${d.id} pitfalls`).toBeGreaterThan(0);
      expect(e!.docs.length, `${d.id} docs`).toBeGreaterThan(0);
      expect(e!.calendar.url, `${d.id} calendar`).toMatch(/^https:\/\//);
      for (const g of e!.glossary) expect(GLOSSARY[g], `${d.id} glossary ${g}`).toBeTruthy();
    }
  });
  it("no explanation is unused, every link is https, and no text reads as a prediction or trade idea", () => {
    const used = new Set(ALL_SERIES.map(explainKey));
    for (const [k, e] of Object.entries(EXPLAIN)) {
      expect(used.has(k), `unused explanation ${k}`).toBe(true);
      for (const doc of e.docs) expect(doc.url, `${k} ${doc.title}`).toMatch(/^https:\/\//);
      const text = [e.measures, e.construction, e.schedule, e.whyMarkets, ...Object.values(e.interpretation), ...e.pitfalls].join(" ");
      expect(text, k).not.toMatch(FORBIDDEN);
    }
  });
});
