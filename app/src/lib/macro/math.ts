import type { Frequency, Observation, PeriodKey, Freshness, SeriesDef, RealRate, SeriesView, AdapterSeries, GapRow, Economy, Indicator, MacroSnapshot } from "./types";
import { SERIES, ECONOMIES, INDICATORS, knownGap } from "./config";

// ────────────────────────────────────────────────────────────
// Pure maths for the Macro Hub. No I/O, no clock reads (the caller passes `now`),
// so every function is unit-testable on fixed fixtures. Nothing here forecasts or
// judges a value; it only normalises, computes year-on-year changes, measures age
// and subtracts two published numbers.
// ────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Canonicalises a provider period string for a frequency. Returns null if it cannot be read (never guesses). */
export function canonicalPeriod(raw: string, freq: Frequency): PeriodKey | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-Q([1-4])$/))) return freq === "quarterly" ? `${m[1]}-Q${m[2]}` : null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (freq === "daily") return s;
    if (freq === "monthly") return `${y}-${pad(mo)}`;
    return `${y}-Q${Math.ceil(mo / 3)}`; // quarterly given as a date (some RBA tables use the quarter-end date)
  }
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) {
    const mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    if (freq === "monthly") return s;
    if (freq === "quarterly") return `${m[1]}-Q${Math.ceil(mo / 3)}`;
    return null;
  }
  return null;
}

/** Last calendar day of a period, as YYYY-MM-DD. */
export function periodEnd(p: PeriodKey): string {
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^(\d{4})-Q([1-4])$/))) {
    const mo = +m[2] * 3;
    return `${m[1]}-${pad(mo)}-${pad(new Date(Date.UTC(+m[1], mo, 0)).getUTCDate())}`;
  }
  if ((m = p.match(/^(\d{4})-(\d{2})$/))) return `${m[1]}-${m[2]}-${pad(new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate())}`;
  return p;
}

/** First calendar day of a period, as YYYY-MM-DD. */
export function periodStart(p: PeriodKey): string {
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^(\d{4})-Q([1-4])$/))) return `${m[1]}-${pad((+m[2] - 1) * 3 + 1)}-01`;
  if ((m = p.match(/^(\d{4})-(\d{2})$/))) return `${m[1]}-${m[2]}-01`;
  return p;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Human label: "Sep 2026", "Q2 2026", "Oct 7, 2026". English only, independent of the browser locale. */
export function periodLabel(p: PeriodKey): string {
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^(\d{4})-Q([1-4])$/))) return `Q${m[2]} ${m[1]}`;
  if ((m = p.match(/^(\d{4})-(\d{2})$/))) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  if ((m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  return p;
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "n/a";
}

/** The same period one year earlier, or null for a frequency that cannot do year-on-year here. */
export function yearBefore(p: PeriodKey): PeriodKey | null {
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^(\d{4})-(Q[1-4]|\d{2}(?:-\d{2})?)$/))) return `${+m[1] - 1}-${m[2]}`;
  return null;
}

/** Latest observation with a finite value (trailing NA / future placeholders are already dropped by the adapter, but this is defensive). */
export function latestTwo(obs: Observation[]): { latest: Observation | null; previous: Observation | null } {
  const ok = obs.filter((o) => Number.isFinite(o.value));
  return { latest: ok.length ? ok[ok.length - 1] : null, previous: ok.length > 1 ? ok[ok.length - 2] : null };
}

/**
 * Year-on-year % change from a published index: (v_t / v_{t-12m} − 1) × 100.
 * A point is produced only when the exact same period of the previous year exists; there is no
 * interpolation, no nearest-neighbour fallback and no division by zero.
 */
export function yoyFromIndex(index: Observation[]): Observation[] {
  const by = new Map(index.filter((o) => Number.isFinite(o.value)).map((o) => [o.period, o.value]));
  const out: Observation[] = [];
  for (const o of index) {
    if (!Number.isFinite(o.value)) continue;
    const prevKey = yearBefore(o.period);
    const base = prevKey ? by.get(prevKey) : undefined;
    if (base == null || base === 0) continue;
    out.push({ period: o.period, value: (o.value / base - 1) * 100 });
  }
  return out;
}

export function changeOf(latest: Observation | null, previous: Observation | null): number | null {
  return latest && previous ? latest.value - previous.value : null;
}

const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * fresh   : age <= lag
 * stale   : lag < age <= 2×lag   (stays in the table with a STALE flag)
 * hidden  : age > 2×lag          (leaves the table, listed under Coverage gaps)
 * Age is measured from the period end (basis "observation") or from the aggregator's last refresh (basis "refresh").
 */
export function assessFreshness(def: SeriesDef, latestPeriod: PeriodKey | null, refreshedAt: string | null, now: number): Freshness | null {
  const from = def.lag.basis === "refresh" ? (refreshedAt ? refreshedAt.slice(0, 10) : null) : (latestPeriod ? periodEnd(latestPeriod) : null);
  if (!from) return null;
  const ageDays = Math.max(0, Math.floor((now - toMs(from)) / DAY));
  const lagDays = def.lag.days;
  const state = ageDays <= lagDays ? "fresh" : ageDays <= 2 * lagDays ? "stale" : "hidden";
  return { state, ageDays, lagDays, basis: def.lag.basis, from };
}

/** Turns one adapter result into the view the UI renders (applies the computed transform, never changes provider values). */
export function buildView(def: SeriesDef, a: AdapterSeries | undefined, now: number): SeriesView {
  const base: SeriesView = {
    def, latest: null, previous: null, change: null, computed: def.transform === "yoy", points: [], freshness: null,
    provider: a?.provider ?? def.provider, sourceUrl: a?.sourceUrl ?? "", refreshedAt: a?.refreshedAt ?? null, retrievedAt: a?.retrievedAt ?? null,
  };
  if (!a) return { ...base, error: "Not returned by the data source." };
  if (!a.ok) return { ...base, error: a.error ?? "Data source error." };
  const pts = def.transform === "yoy" ? yoyFromIndex(a.observations) : a.observations.filter((o) => Number.isFinite(o.value));
  const { latest, previous } = latestTwo(pts);
  if (!latest) return { ...base, error: def.transform === "yoy" ? "Not enough history to compute a year-on-year change." : "The source returned no usable values." };
  return {
    ...base, latest, previous, change: changeOf(latest, previous), points: pts,
    freshness: assessFreshness(def, latest.period, a.refreshedAt, now),
  };
}

/**
 * Real policy rate = policy rate − CPI YoY (latest available of each). Computed only when BOTH inputs are
 * fresh; it never hides a mismatch of dates or frequencies: both periods and frequencies are returned.
 */
export function realPolicyRate(economy: Economy, policy: SeriesView | undefined, cpi: SeriesView | undefined): RealRate {
  const empty = { economy, policy: null, cpi: null, value: null, ok: false } as const;
  if (!policy || !cpi) return { ...empty, reason: `${!policy ? "no policy-rate series" : "no CPI series"} in v1` };
  const describe = (v: SeriesView) => (v.latest ? { value: v.latest.value, period: v.latest.period, frequency: v.def.frequency, label: v.def.label } : null);
  if (policy.error || !policy.latest) return { ...empty, reason: `policy rate unavailable (${policy.error ?? "no value"})` };
  if (cpi.error || !cpi.latest) return { ...empty, reason: `CPI unavailable (${cpi.error ?? "no value"})` };
  const out = { economy, policy: describe(policy), cpi: describe(cpi) };
  if (policy.freshness?.state !== "fresh") return { ...out, ok: false, value: null, reason: "policy rate is STALE" };
  if (cpi.freshness?.state !== "fresh") return { ...out, ok: false, value: null, reason: "CPI is STALE" };
  return { ...out, ok: true, value: policy.latest.value - cpi.latest.value };
}

export interface MacroViews {
  /** series shown in the table (fresh or stale) */
  shown: SeriesView[];
  /** every economy × indicator cell not shown, with the reason */
  gaps: GapRow[];
  realRates: RealRate[];
  /** economies whose real policy rate is computable */
  realRateCount: number;
}

/** Whole-page derivation: which series are shown, every gap with its reason, and the real policy rates. */
export function buildViews(snap: Pick<MacroSnapshot, "series"> | undefined, now: number): MacroViews {
  const byId = new Map((snap?.series ?? []).map((s) => [s.id, s]));
  const all = SERIES.map((d) => buildView(d, byId.get(d.id), now));
  const shown: SeriesView[] = [];
  const gaps: GapRow[] = [];
  const cell = new Map<string, SeriesView>();
  for (const v of all) {
    cell.set(`${v.def.economy}|${v.def.indicator}`, v);
    if (v.error) continue;
    if (v.freshness?.state === "hidden") continue;
    shown.push(v);
  }
  for (const e of ECONOMIES) for (const i of INDICATORS) {
    const v = cell.get(`${e.id}|${i.id}`);
    if (!v) { const g = knownGap(e.id, i.id); gaps.push({ economy: e.id, indicator: i.id, ...g }); continue; }
    if (v.error) gaps.push({ economy: e.id, indicator: i.id, kind: "fetch_error", reason: `${v.def.label}: ${v.error}` });
    else if (v.freshness?.state === "hidden") {
      gaps.push({ economy: e.id, indicator: i.id, kind: "too_old", reason: `${v.def.label}: latest observation ${periodLabel(v.latest!.period)} is ${v.freshness.ageDays} days old, more than twice its expected lag of ${v.freshness.lagDays} days.` });
    }
  }
  const realRates = ECONOMIES.map((e) => realPolicyRate(e.id, cell.get(`${e.id}|policy_rate`), cell.get(`${e.id}|cpi_yoy`)));
  return { shown, gaps, realRates, realRateCount: realRates.filter((r) => r.ok).length };
}

export const REAL_RATE_LABEL = "computed: policy rate minus CPI YoY, latest available of each, observation dates shown";
/** The comparison view is only built when at least this many economies have a computable real policy rate. */
export const MIN_ECONOMIES_FOR_COMPARISON = 3;

// ───────────── formatting (explicit en-US, English only) ─────────────

export function fmtValue(v: number | null | undefined, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtChange(v: number | null | undefined, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const r = Math.round(Math.abs(v) * 10 ** decimals) / 10 ** decimals;
  return `${r === 0 ? "" : v > 0 ? "+" : "−"}${r.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
