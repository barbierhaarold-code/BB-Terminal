// ────────────────────────────────────────────────────────────
// Macro Hub — shared types. The UI, the maths and the Copilot tool only ever see
// these shapes; none of them knows which adapter (today: DBnomics) produced a series.
// ────────────────────────────────────────────────────────────

/** Which server-side adapter fetches a series. The UI and the maths never look at this. */
export type AdapterId = "dbnomics" | "bls" | "fred" | "eurostat" | "statcan" | "boc" | "boe" | "snb" | "bis" | "jpstat" | "imf" | "fiscaldata" | "nyfedsce" | "mof";
/** Why a series has no data, when that is more specific than "error". */
export type ErrorKind = "error" | "key_missing" | "key_rejected" | "blocked";

export type Economy = "US" | "EA" | "UK" | "JP" | "CA" | "AU" | "NZ" | "CH";
export type Indicator = "policy_rate" | "cpi_yoy" | "core_cpi_yoy" | "unemployment" | "gdp_growth" | "yield_10y";
export type Frequency = "daily" | "weekly" | "monthly" | "quarterly";

/**
 * Canonical period keys, so every layer compares periods the same way:
 * daily and weekly "2026-10-07" (weekly = the provider's week-ending or week-starting date), monthly "2026-08", quarterly "2026-Q2".
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

/**
 * How the headline value is derived from what the provider publishes. "none": shown as published.
 * "yoy": % change versus the same period a year earlier. "mom": % change versus the previous period.
 * "diff": difference versus the previous period, in the published unit (e.g. payroll gains).
 * Anything other than "none" is labelled "computed".
 */
export type Headline = "none" | "yoy" | "mom" | "diff";
/** Chart transformations offered in the detail view (all computed by the terminal except "level"). */
export type ChartTransform = "level" | "mom" | "yoy" | "ann3m" | "diff";

export type Topic = "inflation" | "labour" | "growth" | "money" | "rates" | "fiscal" | "surveys";

export interface SeriesDef {
  id: string;
  economy: Economy;
  /** the G8 overview cell this series fills; null for series outside the 6-indicator matrix (US deep coverage) */
  indicator: Indicator | null;
  adapter: AdapterId;
  /** adapter-specific address; for DBnomics "PROVIDER/DATASET/SERIES", for BLS/FRED the series id, for Eurostat "dataset?filters" … (see each adapter) */
  code: string;
  frequency: Frequency;
  kind: SeriesKind;
  /** headline derivation (see Headline). "yoy" on an index is the classic computed inflation rate. */
  transform: Headline;
  label: string;
  /** what the number is, incl. basis (e.g. "q/q annualised") */
  basis: string;
  /** unit of the HEADLINE value (after `transform`): "%", "pp", "index", "k" (thousands), "persons", "usd_mn", "usd_bn", "usd_hr", "ratio" */
  unit: Unit;
  decimals: number;
  provider: string;
  attribution: string;
  licenceNote: string;
  /** shown directly next to the value (table, detail header) and repeated in the Copilot output */
  valueNote?: string;
  lag: LagRule;
  // ── detail-view metadata (all optional; absence is shown as "not available" with a reason) ──
  /** short display name used in the US deep tables and the detail header (defaults to the indicator name) */
  name?: string;
  topic?: Topic;
  /** originating agency when the data reach us through a republisher (FRED, DBnomics, BIS…) */
  agency?: string;
  /** unit of the series as PUBLISHED (before `transform`), for the "level" chart */
  sourceUnit?: Unit;
  /** chart transformations that are meaningful for this series (default: level only) */
  chart?: ChartTransform[];
  /** key into EXPLAIN (static, reviewed text) */
  explain?: string;
  /** related series ids (any catalogue), clickable in the detail view */
  related?: string[];
  /** official release calendar, linked when no machine-readable next-release date is available */
  calendar?: { url: string; label: string };
  /** true: measure release-day market reactions from ALFRED first releases (FRED monthly/quarterly/weekly series only) */
  reaction?: boolean;
  /** false: do not query ALFRED vintages (market rates, computed spreads: never revised) */
  vintages?: boolean;
}

export type Unit = "%" | "pp" | "index" | "k" | "persons" | "usd" | "usd_mn" | "usd_bn" | "usd_hr" | "ratio" | "bp";

/** A series that fills a G8 overview cell. */
export type MatrixDef = SeriesDef & { indicator: Indicator };

export type FreshState = "fresh" | "stale" | "hidden";

export interface Freshness {
  state: FreshState;
  ageDays: number;
  lagDays: number;
  basis: "observation" | "refresh";
  /** the date the age is measured from (YYYY-MM-DD) */
  from: string;
}

export interface SeriesView<D extends SeriesDef = MatrixDef> {
  def: D;
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
