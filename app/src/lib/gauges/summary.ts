import { CHANGE_DEFINITION, COMPLETED_LABEL, INTRADAY_LABEL, GAUGES_NOTE, PERCENTILE_DEFINITION, STRENGTH_FORMULA } from "./config";
import type { GaugesBundle } from "./data";
import { maybeIntraday } from "./math";

const r = (n: number | null, d = 3) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Read-only Copilot payload: the same numbers as the GAUGES page, with definitions and as-of dates. */
export function summariseGauges(b: GaugesBundle, section: "vol" | "strength" | "both" = "both") {
  const out: Record<string, unknown> = { available: true, fetchedAt: b.fetchedAt };
  if (section !== "strength") {
    out.volatility = {
      indices: b.vol.map((v) => ({
        index: v.label, measures: v.measures, level: r(v.level), asOf: v.asOf, latestBar: maybeIntraday(v.asOf, Date.now()) ? INTRADAY_LABEL : COMPLETED_LABEL,
        change1dPoints: r(v.change1d?.points ?? null), change1dPct: r(v.change1d?.pct ?? null, 2),
        change5dPoints: r(v.change5d?.points ?? null), change5dPct: r(v.change5d?.pct ?? null, 2),
        percentile1y: r(v.pctile1y, 1), percentile5y: r(v.pctile5y, 1), warnings: v.warnings,
      })),
      unavailable: b.volFailures.map((f) => ({ index: f.label, reason: f.error })),
      definitions: { percentile: PERCENTILE_DEFINITION, change: CHANGE_DEFINITION },
    };
  }
  if (section !== "vol") {
    out.currencyStrength = {
      asOf: b.strength.asOf,
      pairsUsed: b.strength.pairsUsed, pairsLeftOut: b.strength.pairsLeftOut,
      byLookback: b.strength.results.map((x) => ({
        lookbackTradingDays: x.lookback, from: x.from, to: x.to,
        ranking: x.rows.filter((q) => q.rank != null).sort((a, c) => (a.rank as number) - (c.rank as number)).map((q) => ({ rank: q.rank, currency: q.currency, strengthPct: r(q.value) })),
        notAvailable: x.rows.filter((q) => q.rank == null).map((q) => q.currency),
      })),
      formula: STRENGTH_FORMULA,
    };
  }
  out.meta = { note: GAUGES_NOTE, instruction: "State the as-of date and the lookback with every figure; where latestBar says 'intraday (session in progress)' say so, because that level is not a final close. Strength is a relative-performance description of past moves over the stated window, not a prediction; a percentile describes where a level sits in its own history, not what comes next. Never present either as a signal or advice. If an index or pair is listed as unavailable, say so instead of estimating it." };
  return out;
}
