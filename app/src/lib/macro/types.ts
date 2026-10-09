// ────────────────────────────────────────────────────────────
// Macro Hub — shared types. The UI, the maths and the Copilot tool only ever see
// these shapes; none of them knows which adapter (today: DBnomics) produced a series.
// ────────────────────────────────────────────────────────────

/** Which server-side adapter fetches a series. The UI and the maths never look at this. */
export type AdapterId = "dbnomics" | "bls" | "fred" | "eurostat" | "statcan" | "boc" | "boe" | "snb" | "bis" | "jpstat" | "imf";
/** Why a series has no data, when that is more specific than "error". */
export type ErrorKind = "error" | "key_missing" | "key_rejected" | "blocked";

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
  /** Non-blocking note: the data IS served, but through a fallback route (e.g. a missing/rejected API key with a keyless endpoint). */
  notice?: { kind: "key_missing" | "key_rejected"; message: string };
  errorKind?: ErrorKind;         // set when the cause is a missing/rejected API key or a bot challenge
  observations: Observation[];   // ascending by period, NA values already dropped
  provider: string;              // e.g. "Federal Reserve Board"
  sourceUrl: string;             // where a human can see the series
  refreshedAt: string | null;    // ISO: when the provider/aggregator last updated this series (DBnomics `indexed_at`, Eurostat `updated`, SNB PublishingDate…); null if the source gives none
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
  adapter: AdapterId;
  /** adapter-specific address; for DBnomics "PROVIDER/DATASET/SERIES", for BLS/FRED the series id, for Eurostat "dataset?filters" … (see each adapter) */
  code: string;
  frequency: Frequency;
  kind: SeriesKind;
  /** "yoy": the provider publishes an index (or a level) and this terminal computes the year-on-year % change */
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
  errorKind?: ErrorKind;
  notice?: { kind: "key_missing" | "key_rejected"; message: string };
}

export interface GapRow { economy: Economy; indicator: Indicator; kind: "no_series" | "excluded_provider" | "stale_mirror" | "not_pinned" | "fetch_error" | "too_old" | "key_missing" | "key_rejected" | "blocked"; reason: string }

export interface RealRate {
  economy: Economy;
  ok: boolean;
  value: number | null;
  policy: { value: number; period: PeriodKey; frequency: Frequency; label: string } | null;
  cpi: { value: number; period: PeriodKey; frequency: Frequency; label: string } | null;
  /** why it is not computed */
  reason?: string;
}
