import { ALL_SERIES, ALL_BY_ID, seriesName } from "./catalog";
import { ECONOMY_NAME, INDICATOR_NAME } from "./config";
import { windowStats, type MacroDetail } from "./detail";
import { explainKey, explanationOf } from "./explain";
import { applyHeadline, assessFreshness, dateLabel, latestTwo, periodLabel } from "./math";
import type { SeriesDef } from "./types";

// Read-only Copilot payload for one Macro Hub indicator: the same numbers as its detail view, with source,
// series id, observation period and publication date on every figure. Descriptive only.

const round = (n: number | null | undefined, d = 4) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Resolves an id or a free-text query (optionally within one economy) to one indicator, or to a short list of candidates. */
export function resolveIndicator(input: { id?: unknown; query?: unknown; economy?: unknown }): { def: SeriesDef } | { candidates: Array<{ id: string; name: string; economy: string }> } | { error: string } {
  const id = typeof input.id === "string" ? input.id.trim().toLowerCase() : "";
  if (id) return ALL_BY_ID[id] ? { def: ALL_BY_ID[id] } : { error: `Unknown indicator id "${id}". Call again with "query" to search by name.` };
  const q = typeof input.query === "string" ? norm(input.query) : "";
  if (!q) return { error: 'Give "id" (e.g. "us.cpi") or "query" (e.g. "core PCE").' };
  const econ = typeof input.economy === "string" ? input.economy.trim().toUpperCase() : "";
  const pool = ALL_SERIES.filter((d) => !econ || d.economy === econ);
  const words = q.split(" ");
  const scored = pool.map((d) => {
    const hay = norm(`${seriesName(d, INDICATOR_NAME)} ${d.label} ${d.code} ${d.id}`);
    return { d, score: words.filter((w) => hay.includes(w)).length + (norm(seriesName(d, INDICATOR_NAME)) === q ? 5 : 0) };
  }).filter((x) => x.score === words.length || x.score >= 5).sort((a, b) => b.score - a.score);
  if (scored.length === 1 || (scored.length > 1 && scored[0].score > scored[1].score)) return { def: scored[0].d };
  if (scored.length === 0) return { error: `No indicator matches "${input.query}"${econ ? ` in ${econ}` : ""}.` };
  return { candidates: scored.slice(0, 8).map(({ d }) => ({ id: d.id, name: seriesName(d, INDICATOR_NAME), economy: ECONOMY_NAME[d.economy] })) };
}

export function indicatorSummary(def: SeriesDef, d: MacroDetail, now: number) {
  const headline = applyHeadline(d.history, def.transform, def.frequency);
  const { latest, previous } = latestTwo(headline);
  const fresh = latest ? assessFreshness(def, latest.period, d.refreshedAt, now) : null;
  const stats = [5, 10, null].map((y) => windowStats(headline, y)).filter(Boolean).map((s) => ({
    window: s!.window, from: periodLabel(s!.from), to: periodLabel(s!.to), n: s!.n,
    percentileOfLatest: round(s!.percentile, 1), mean: round(s!.mean), zScore: round(s!.z, 2),
    min: { value: round(s!.min.value), period: periodLabel(s!.min.period) }, max: { value: round(s!.max.value), period: periodLabel(s!.max.period) },
  }));
  const ex = explanationOf(def);
  const rev = d.revisions.available
    ? { tracked: true, source: d.revisions.source, latest: d.revisions.latest && { period: periodLabel(d.revisions.latest.period), firstPrint: round(d.revisions.latest.firstPrint), current: round(d.revisions.latest.current), steps: d.revisions.latest.steps.length } , previous: d.revisions.previous && { period: periodLabel(d.revisions.previous.period), firstPrint: round(d.revisions.previous.firstPrint), current: round(d.revisions.previous.current), steps: d.revisions.previous.steps.length } }
    : { tracked: false, why: d.revisions.reason };
  const reaction = d.reaction.available
    ? {
        measured: true, basis: d.reaction.basis, window: d.reaction.window, releases: d.reaction.releases, from: d.reaction.from, to: d.reaction.to,
        assets: d.reaction.assets.map((a) => ({ asset: a.asset, unit: a.unit, proxy: a.proxyNote ?? null, upN: a.up.n, downN: a.down.n, difference: round(a.diff?.estimate, 3), ci95: a.diff ? a.diff.ci.map((c) => round(c, 3)) : null, result: a.verdict })),
        caveats: d.reaction.caveats,
      }
    : { measured: false, why: d.reaction.reason };
  return {
    available: true as const,
    id: def.id, name: seriesName(def, INDICATOR_NAME), economy: ECONOMY_NAME[def.economy],
    label: def.label, basis: def.basis, unit: def.unit, frequency: def.frequency,
    latest: latest ? { value: round(latest.value), observationPeriod: periodLabel(latest.period) } : null,
    previous: previous ? { value: round(previous.value), observationPeriod: periodLabel(previous.period) } : null,
    change: latest && previous ? round(latest.value - previous.value) : null,
    computed: def.transform !== "none" ? `computed by the terminal (${def.transform}) from the published series` : false,
    valueNote: def.valueNote ?? null,
    stale: fresh?.state !== "fresh", ageDays: fresh?.ageDays ?? null, expectedLagDays: fresh?.lagDays ?? null,
    publishedAtSource: d.refreshedAt ? dateLabel(d.refreshedAt) : "not available from the source",
    nextRelease: d.release?.next ? { date: dateLabel(d.release.next), release: d.release.name, note: d.release.nextNote } : { date: null, note: d.release?.nextNote ?? `No machine-readable calendar used; official calendar: ${ex?.calendar.url ?? "n/a"}` },
    source: { provider: d.provider, agency: def.agency ?? null, seriesId: def.adapter === "fred" ? `FRED ${def.code}` : def.code, url: d.sourceUrl, attribution: def.attribution, licence: def.licenceNote },
    historySummary: { observations: d.history.length, first: d.history[0] ? periodLabel(d.history[0].period) : null, last: d.history.at(-1) ? periodLabel(d.history.at(-1)!.period) : null, statistics: stats },
    revisions: rev,
    marketReaction: reaction,
    explanationId: explainKey(def),
    explanation: ex ? { measures: ex.measures, whyMarketsFollowIt: ex.whyMarkets, pitfalls: ex.pitfalls } : null,
    related: (def.related ?? []).filter((r) => ALL_BY_ID[r]),
    note: "Descriptive data for context, not a forecast, signal or advice. Always state the observation period and the source. Market-reaction results are historical averages with their sample size and 95% interval; relay 'not significant' plainly.",
  };
}
