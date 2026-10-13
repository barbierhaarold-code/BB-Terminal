import { US_EXPLAIN_A } from "./explainUsA";
import { US_EXPLAIN_B } from "./explainUsB";
import { INTL_EXPLAIN } from "./explainIntl";
import type { Explanation } from "./explainBase";
import type { SeriesDef } from "./types";

export { GLOSSARY, type DocLink, type Explanation, type GlossaryId } from "./explainBase";

// Every explanation, keyed by SeriesDef.explain (or the series id). Static, reviewed, educational; no live generation.
export const EXPLAIN: Record<string, Explanation> = { ...US_EXPLAIN_A, ...US_EXPLAIN_B, ...INTL_EXPLAIN };

/** The explanation key of a series (its `explain` field, or its id). */
export const explainKey = (d: SeriesDef) => d.explain ?? d.id;
export const explanationOf = (d: SeriesDef): Explanation | null => EXPLAIN[explainKey(d)] ?? null;
