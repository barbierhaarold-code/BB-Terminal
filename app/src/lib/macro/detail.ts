import type { ChartTransform, Frequency, Headline, Observation, PeriodKey } from "./types";
import { applyHeadline, periodBefore, periodChange, periodEnd, yoyFromIndex } from "./math";

// ────────────────────────────────────────────────────────────
// Pure maths for the indicator detail view: chart transformations, descriptive statistics,
// ALFRED revisions, first-release reconstruction and release-day market reactions.
// No I/O and no clock reads, so every function is tested on fixtures. Nothing here forecasts:
// statistics describe the past, and a reaction is reported only with its sample size and a 95%
// confidence interval, labelled "not significant" when the interval contains zero.
// ────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

// ───────────── chart transformations ─────────────

/** 3-month annualised % change: ((v_t / v_{t-3})^4 − 1) × 100 for monthly series; exact periods only. */
export function annualised3m(obs: Observation[], freq: Frequency): Observation[] {
  if (freq !== "monthly") return [];
  const by = new Map(obs.map((o) => [o.period, o.value]));
  const out: Observation[] = [];
  for (const o of obs) {
    let p: PeriodKey | null = o.period;
    for (let i = 0; i < 3 && p; i++) p = periodBefore(p, "monthly");
    const base = p ? by.get(p) : undefined;
    if (base == null || base <= 0 || o.value <= 0) continue;
    out.push({ period: o.period, value: (Math.pow(o.value / base, 4) - 1) * 100 });
  }
  return out;
}

/** Applies a chart transformation to the published observations. "level" is the series as published. */
export function chartSeries(published: Observation[], t: ChartTransform, freq: Frequency): Observation[] {
  const ok = published.filter((o) => Number.isFinite(o.value));
  switch (t) {
    case "level": return ok;
    case "yoy": return yoyFromIndex(ok, freq);
    case "mom": return periodChange(ok, freq, "mom");
    case "diff": return periodChange(ok, freq, "diff");
    case "ann3m": return annualised3m(ok, freq);
  }
}

export const TRANSFORM_LABEL: Record<ChartTransform, string> = {
  level: "Level (as published)",
  mom: "Period-on-period % (computed)",
  yoy: "Year-on-year % (computed)",
  ann3m: "3-month annualised % (computed)",
  diff: "Change vs previous period (computed)",
};

/** Which headline a ChartTransform reproduces (so the default chart equals the table's number). */
export function headlineTransform(h: Headline): ChartTransform {
  return h === "none" ? "level" : h;
}

// ───────────── descriptive statistics ─────────────

export interface WindowStats {
  window: string;          // "5Y", "10Y", "All history"
  from: PeriodKey; to: PeriodKey; n: number;
  percentile: number;      // share of observations in the window ≤ latest, in % (0–100)
  min: Observation; max: Observation;
  mean: number; sd: number | null;
  z: number | null;        // (latest − mean) / sd; null if sd is 0 or n < 3
}

/** Descriptive statistics of the latest value versus a trailing window (by calendar years from the latest period end). */
export function windowStats(points: Observation[], years: number | null): WindowStats | null {
  const ok = points.filter((o) => Number.isFinite(o.value));
  if (ok.length < 2) return null;
  const latest = ok[ok.length - 1];
  const endMs = toMs(periodEnd(latest.period));
  const w = years == null ? ok : ok.filter((o) => toMs(periodEnd(o.period)) > endMs - years * 365.25 * DAY);
  if (w.length < 2) return null;
  const n = w.length;
  const mean = w.reduce((a, o) => a + o.value, 0) / n;
  const sd = n >= 3 ? Math.sqrt(w.reduce((a, o) => a + (o.value - mean) ** 2, 0) / (n - 1)) : null;
  let min = w[0], max = w[0];
  for (const o of w) { if (o.value < min.value) min = o; if (o.value > max.value) max = o; }
  const percentile = (w.filter((o) => o.value <= latest.value).length / n) * 100;
  return {
    window: years == null ? "All history" : `${years}Y`, from: w[0].period, to: latest.period, n,
    percentile, min, max, mean, sd, z: sd && sd > 0 ? (latest.value - mean) / sd : null,
  };
}

// ───────────── ALFRED vintages ─────────────

/** One ALFRED row: the value of `period` as known from `start` to `end` (inclusive dates, "9999-12-31" = still current). */
export interface VintageRow { period: PeriodKey; start: string; end: string; value: number }

/** The whole series as it was known on date `d` (YYYY-MM-DD). */
export function asOf(rows: VintageRow[], d: string): Observation[] {
  const out: Observation[] = [];
  for (const r of rows) if (r.start <= d && d <= r.end) out.push({ period: r.period, value: r.value });
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export interface RevisionStep { date: string; value: number }
export interface Revisions { period: PeriodKey; steps: RevisionStep[]; firstPrint: number; current: number; total: number }

/**
 * How the HEADLINE value of `period` changed across vintages: one step per vintage date on which it changed
 * (to `decimals` places). Works on the headline (e.g. y/y from an index), recomputed from each vintage.
 */
export function revisionsFor(rows: VintageRow[], period: PeriodKey, headline: Headline, freq: Frequency, decimals: number): Revisions | null {
  let firstSeen: string | null = null;
  for (const r of rows) if (r.period === period && (!firstSeen || r.start < firstSeen)) firstSeen = r.start;
  if (!firstSeen) return null;
  const dates = [...new Set(rows.map((r) => r.start))].filter((d) => d >= firstSeen!).sort();
  const steps: RevisionStep[] = [];
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  for (const d of dates) {
    const h = applyHeadline(asOf(rows, d), headline, freq).find((o) => o.period === period);
    if (!h) continue;
    if (!steps.length || round(steps[steps.length - 1].value) !== round(h.value)) steps.push({ date: d, value: h.value });
  }
  if (!steps.length) return null;
  const firstPrint = steps[0].value, current = steps[steps.length - 1].value;
  return { period, steps, firstPrint, current, total: current - firstPrint };
}

export interface FirstRelease { period: PeriodKey; date: string; value: number; previous: number | null; previousPeriod: PeriodKey | null }

/**
 * Every period's first release, in headline terms, together with the previous period's headline AS KNOWN on that
 * release day. A period whose first vintage is implausibly late (ALFRED coverage starting after the fact) is dropped:
 * the first-vintage date must fall within `maxLagDays` of the period end.
 */
export function firstReleases(rows: VintageRow[], headline: Headline, freq: Frequency, maxLagDays: number): FirstRelease[] {
  const first = new Map<PeriodKey, string>();
  for (const r of rows) { const f = first.get(r.period); if (!f || r.start < f) first.set(r.period, r.start); }
  const out: FirstRelease[] = [];
  const byDate = new Map<string, Observation[]>();
  for (const [period, date] of [...first].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lagDays = (toMs(date) - toMs(periodEnd(period))) / DAY;
    if (lagDays < 0 || lagDays > maxLagDays) continue;
    let h = byDate.get(date);
    if (!h) { h = applyHeadline(asOf(rows, date), headline, freq); byDate.set(date, h); }
    const i = h.findIndex((o) => o.period === period);
    if (i < 0) continue;
    const prev = i > 0 ? h[i - 1] : null;
    out.push({ period, date, value: h[i].value, previous: prev?.value ?? null, previousPeriod: prev?.period ?? null });
  }
  return out;
}

// ───────────── release-day market reactions ─────────────

/** Two-sided 97.5% Student-t quantile (table for small df, normal beyond 120). */
export function tCrit975(df: number): number {
  const T: Array<[number, number]> = [[1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
    [12, 2.179], [15, 2.131], [20, 2.086], [25, 2.06], [30, 2.042], [40, 2.021], [60, 2.0], [80, 1.99], [120, 1.98]];
  if (!(df >= 1)) return NaN;
  if (df >= 120) return 1.96;
  for (let i = 0; i < T.length; i++) {
    if (df <= T[i][0]) {
      if (i === 0 || df === T[i][0]) return T[i][1];
      const [d0, t0] = T[i - 1], [d1, t1] = T[i];
      return t0 + ((df - d0) / (d1 - d0)) * (t1 - t0); // linear in df: conservative enough for a CI label
    }
  }
  return 1.96;
}

export interface GroupStat { n: number; mean: number | null; ci: [number, number] | null }
export interface DiffStat { estimate: number; ci: [number, number]; df: number; significant: boolean }

export function groupStat(xs: number[]): GroupStat {
  const n = xs.length;
  if (n === 0) return { n, mean: null, ci: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, ci: null };
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const h = tCrit975(n - 1) * sd / Math.sqrt(n);
  return { n, mean, ci: [mean - h, mean + h] };
}

/** Welch two-sample difference of means (a − b) with a 95% CI. Null if either group has fewer than 2 values. */
export function welchDiff(a: number[], b: number[]): DiffStat | null {
  if (a.length < 2 || b.length < 2) return null;
  const m = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = (xs: number[], mu: number) => xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
  const ma = m(a), mb = m(b), va = v(a, ma) / a.length, vb = v(b, mb) / b.length;
  const se = Math.sqrt(va + vb);
  if (se === 0) return null;
  const df = (va + vb) ** 2 / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1));
  const est = ma - mb, h = tCrit975(df) * se;
  const ci: [number, number] = [est - h, est + h];
  return { estimate: est, ci, df, significant: ci[0] > 0 || ci[1] < 0 };
}

export interface AssetSeries { id: string; label: string; unit: "bp" | "%"; proxyNote?: string; source: string; points: Map<string, number> }

/** Close-to-close move into release day `d`: (x_d − x_prev) in bp for yields, in % for price levels. Null if either close is missing or the previous one is more than 5 days earlier. */
export function releaseDayMove(a: AssetSeries, d: string, sortedDates: string[]): number | null {
  const x1 = a.points.get(d);
  if (x1 == null) return null;
  let lo = 0, hi = sortedDates.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sortedDates[mid] < d) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx < 0) return null;
  const p = sortedDates[idx];
  if ((toMs(d) - toMs(p)) / DAY > 5) return null;
  const x0 = a.points.get(p)!;
  return a.unit === "bp" ? (x1 - x0) * 100 : x0 !== 0 ? (x1 / x0 - 1) * 100 : null;
}

export interface AssetReaction {
  asset: string; unit: "bp" | "%"; proxyNote?: string; source: string;
  up: GroupStat; down: GroupStat; diff: DiffStat | null;
  verdict: "significant" | "not significant" | "insufficient sample";
}

export interface ReactionResult {
  available: true;
  basis: string;        // how releases were classified
  window: string;       // what move was measured
  from: string; to: string;
  releases: number;     // releases considered (with a direction)
  unchanged: number;    // releases with no change at the displayed precision (excluded)
  assets: AssetReaction[];
  caveats: string[];
}

export const MIN_GROUP = 8;

/**
 * Release-day reaction by direction of the change. A release is "up" when its first-print headline exceeds the previous
 * period's headline as known on that day (rounded to the displayed decimals), "down" when below; ties are excluded.
 */
export function measureReactions(releases: FirstRelease[], decimals: number, assets: AssetSeries[], fromDate: string): Omit<ReactionResult, "basis" | "window" | "caveats"> {
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const used = releases.filter((r) => r.date >= fromDate && r.previous != null);
  let unchanged = 0;
  const dirs: Array<{ date: string; dir: 1 | -1 }> = [];
  for (const r of used) {
    const d = round(r.value) - round(r.previous!);
    if (Math.abs(d) < 10 ** -(decimals + 3)) { unchanged++; continue; }
    dirs.push({ date: r.date, dir: d > 0 ? 1 : -1 });
  }
  const out: AssetReaction[] = assets.map((a) => {
    const dates = [...a.points.keys()].sort();
    const up: number[] = [], down: number[] = [];
    for (const { date, dir } of dirs) {
      const mv = releaseDayMove(a, date, dates);
      if (mv == null || !Number.isFinite(mv)) continue;
      (dir > 0 ? up : down).push(mv);
    }
    const diff = up.length >= MIN_GROUP && down.length >= MIN_GROUP ? welchDiff(up, down) : null;
    return {
      asset: a.label, unit: a.unit, proxyNote: a.proxyNote, source: a.source, up: groupStat(up), down: groupStat(down), diff,
      verdict: !diff ? "insufficient sample" : diff.significant ? "significant" : "not significant",
    };
  });
  const dates = dirs.map((d) => d.date).sort();
  return { available: true, from: dates[0] ?? fromDate, to: dates[dates.length - 1] ?? fromDate, releases: dirs.length, unchanged, assets: out };
}

// ───────────── the detail payload (/macro-proxy/series?id=…) ─────────────

export interface MacroDetail {
  id: string;
  fetchedAt: string;
  /** the full published history (BEFORE the headline transform), ascending */
  history: Observation[];
  provider: string;
  sourceUrl: string;
  /** date the latest value was published/last revised at the source (FRED realtime_start, provider update stamp) */
  refreshedAt: string | null;
  fredMeta: { title: string; units: string; seasonalAdjustment: string; lastUpdated: string; observationStart: string; observationEnd: string } | null;
  release: { name: string; link: string | null; fredReleaseId: number; next: string | null; nextNote: string } | null;
  revisions:
    | { available: true; source: string; vintageCount: number; latest: Revisions | null; previous: Revisions | null }
    | { available: false; reason: string };
  reaction: ReactionResult | { available: false; reason: string };
  /** NBER recession date ranges (US series only) */
  recessions: Array<[string, string]> | null;
  warnings: string[];
}

// ───────────── recession shading ─────────────

/** Turns a 0/1 monthly indicator into [start, end] date ranges (first and last day of the recession months). */
export function recessionRanges(indicator: Observation[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let start: string | null = null, last: string | null = null;
  for (const o of indicator) {
    if (o.value === 1) { if (!start) start = `${o.period}-01`; last = o.period; }
    else if (start && last) { out.push([start, periodEnd(last)]); start = null; last = null; }
  }
  if (start && last) out.push([start, periodEnd(last)]);
  return out;
}
