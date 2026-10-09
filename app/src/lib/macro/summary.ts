import { ECONOMY_NAME, INDICATOR_NAME, STALE_RULE_TEXT } from "./config";
import { REAL_RATE_LABEL, MIN_ECONOMIES_FOR_COMPARISON, dateLabel, periodLabel, type MacroViews } from "./math";
import type { Economy, MacroSnapshot } from "./types";

/**
 * Serialisable, read-only summary for the Copilot (and any other text consumer): the same numbers
 * as the Macro Hub page, built from the same views. Honest by construction — dates, provider, STALE flags,
 * the computed real rate with its caveat, and every gap with its reason.
 */
export function macroSummary(views: MacroViews, snap: MacroSnapshot, economy?: Economy) {
  const round = (n: number | null, d = 4) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
  const keep = (e: Economy) => !economy || e === economy;
  return {
    available: true as const,
    source: `Direct provider APIs (BLS, Eurostat, Statistics Canada, Bank of Canada, Bank of England, Swiss National Bank, BIS, Statistics Bureau of Japan, IMF, FRED) and DBnomics (open aggregator; redistributes each provider's data as-is). Each series names its own provider. Retrieved ${snap.fetchedAt} (server cache ${snap.cacheState}).`,
    economies: (Object.keys(ECONOMY_NAME) as Economy[]).filter(keep).map((e) => ({
      economy: ECONOMY_NAME[e],
      series: views.shown.filter((v) => v.def.economy === e).map((v) => ({
        indicator: INDICATOR_NAME[v.def.indicator],
        label: v.def.label,
        basis: v.def.basis,
        latestValue: round(v.latest!.value),
        unit: v.def.unit,
        observationPeriod: periodLabel(v.latest!.period),
        previousValue: round(v.previous?.value ?? null),
        previousPeriod: v.previous ? periodLabel(v.previous.period) : null,
        change: round(v.change),
        computed: v.computed ? "computed by the terminal: year-on-year change from the provider's published index or level" : false,
        republishedBy: /\b(via|republished)\b/i.test(v.provider) ? v.provider : null,
        valueNote: v.def.valueNote ?? null,
        stale: v.freshness?.state === "stale",
        ageDays: v.freshness?.ageDays ?? null,
        expectedLagDays: v.freshness?.lagDays ?? null,
        freshnessBasis: v.freshness?.basis ?? null,
        provider: v.provider,
        sourceLastUpdated: v.refreshedAt ? dateLabel(v.refreshedAt) : null,
        sourceNote: v.notice?.message ?? null,
        attribution: v.def.attribution,
        frequency: v.def.frequency,
      })),
      realPolicyRate: (() => {
        const r = views.realRates.find((x) => x.economy === e)!;
        return r.ok
          ? {
              value: round(r.value), label: REAL_RATE_LABEL,
              policyRate: { value: round(r.policy!.value), observation: periodLabel(r.policy!.period), frequency: r.policy!.frequency },
              cpiYoY: { value: round(r.cpi!.value), observation: periodLabel(r.cpi!.period), frequency: r.cpi!.frequency },
              caveat: "Inputs have different frequencies and observation dates (shown); the result mixes them and is not a point-in-time measure.",
            }
          : { value: null, notComputed: r.reason ?? "inputs unavailable" };
      })(),
    })),
    coverageGaps: views.gaps.filter((g) => keep(g.economy)).map((g) => ({ economy: ECONOMY_NAME[g.economy], indicator: INDICATOR_NAME[g.indicator], kind: g.kind, why: g.reason })),
    warnings: snap.warnings,
    meta: {
      staleRule: STALE_RULE_TEXT,
      comparisonViewRule: `A cross-economy real-rate comparison is shown only when at least ${MIN_ECONOMIES_FOR_COMPARISON} economies qualify; ${views.realRateCount} do today.`,
      note: "Descriptive macro data for context. It is not a forecast, not a signal, and is not live: each value is a monthly, quarterly or daily figure with the observation period shown. Always state the observation period. Say plainly which cells are missing (coverageGaps) rather than estimating them.",
    },
  };
}
