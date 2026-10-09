// ────────────────────────────────────────────────────────────
// Macro Hub — shared types. The UI, the maths and the Copilot tool only ever see
// these shapes; none of them knows which adapter (today: DBnomics) produced a series.
// ────────────────────────────────────────────────────────────

export type Economy = "US" | "EA" | "UK" | "JP" | "CA" | "AU" | "NZ" | "CH";
export type Indicator = "policy_rate" | "cpi_yoy" | "core_cpi_yoy" | "unemployment" | "gdp_growth" | "yield_10y";
export type Frequency = "daily" | "monthly" | "quarterly";

/**
 * Canonical period keys, so every layer compares periods the same way:
 * daily "2026-10-07", monthly "2026-08", quarterly "2026-Q2".
 */
export type PeriodKey = string;

export interface Observation { period: PeriodKey; value: number }

/** What an adapter returns for one series: normalized, provider data as-is (no maths applied). */
export interface AdapterSeries {
  id: string;                    // the SeriesDef id
  ok: boolean;
  error?: string;                // real cause when !ok
  observations: Observation[];   // ascending by period, NA values already dropped
  provider: string;              // e.g. "Federal Reserve Board"
  sourceUrl: string;             // where a human can see the series
  refreshedAt: string | null;    // ISO: when the aggregator last refreshed this series (DBnomics `indexed_at`)
  retrievedAt: string;           // ISO: when this terminal fetched it
}

export interface MacroSnapshot {
  adapter: string;               // "dbnomics"
  fetchedAt: string;
  cacheState: "HIT" | "MISS" | "STALE";
  warnings: string[];
  series: AdapterSeries[];
}

export type SeriesKind = "level" | "step"; // step = changes only at decisions (policy rates)

export interface LagRule {
  /** Worst-case NORMAL age of the latest observation: period length + publication delay. */
  days: number;
  /** "observation": age of the period end. "refresh": age of the aggregator's last refresh (used for step series, whose last observation is a decision date). */
  basis: "observation" | "refresh";
  why: string;
}

export interface SeriesDef {
  id: string;
  economy: Economy;
  indicator: Indicator;
  adapter: "dbnomics";
  /** adapter-specific address; for DBnomics "PROVIDER/DATASET/SERIES" */
  code: string;
  frequency: Frequency;
  kind: SeriesKind;
  /** "yoy": the provider publishes an index and this terminal computes the year-on-year % change */
  transform: "none" | "yoy";
  label: string;
  /** what the number is, incl. basis (e.g. "q/q annualised") */
  basis: string;
  unit: "%" ;
  decimals: number;
  provider: string;
  attribution: string;
  licenceNote: string;
  /** shown directly next to the value (table, detail header) and repeated in the Copilot output */
  valueNote?: string;
  lag: LagRule;
}

export type FreshState = "fresh" | "stale" | "hidden";

export interface Freshness {
  state: FreshState;
  ageDays: number;
  lagDays: number;
  basis: "observation" | "refresh";
  /** the date the age is measured from (YYYY-MM-DD) */
  from: string;
}

export interface SeriesView {
  def: SeriesDef;
  /** latest non-missing observation (after any computed transform) */
  latest: Observation | null;
  previous: Observation | null;
  change: number | null;
  computed: boolean;
  /** chart/sparkline points, ascending */
  points: Observation[];
  freshness: Freshness | null;
  provider: string;
  sourceUrl: string;
  refreshedAt: string | null;
  retrievedAt: string | null;
  error?: string;
}

export interface GapRow { economy: Economy; indicator: Indicator; kind: "no_series" | "excluded_provider" | "stale_mirror" | "not_pinned" | "fetch_error" | "too_old"; reason: string }

export interface RealRate {
  economy: Economy;
  ok: boolean;
  value: number | null;
  policy: { value: number; period: PeriodKey; frequency: Frequency; label: string } | null;
  cpi: { value: number; period: PeriodKey; frequency: Frequency; label: string } | null;
  /** why it is not computed */
  reason?: string;
}
