// Market Lean — shared types. Pure data shapes only (no I/O).

export interface Bar { date: string; close: number }

export type DriverId = "trend" | "positioning" | "dollarRates" | "risk" | "cross";
export type Direction = "bullish" | "bearish" | "neutral" | "n/a";
export type LeanLabel = "Bullish lean" | "Bearish lean" | "Mixed" | "Insufficient data";

/** A series the engine can read: Yahoo daily closes, or a Fed yield in percent. */
export type SeriesKind = "price" | "yield" | "vol";

/** Point-in-time COT reading for the instrument's mapped contract + trader group. */
export interface CotReading {
  contractKey: string;
  contractName: string;
  groupId: string;
  groupLabel: string;
  /** Tuesday the positions are as of */
  asOf: string;
  net: number;
  changeNet: number | null;
  pct3y: number | null;
  pct5y: number | null;
}

export interface LeanInputs {
  instrumentId: string;
  /** date label of the target's last bar; own series use bars <= asOf, every other series bars < asOf (no intraday-ordering leak) */
  asOf: string;
  series: Record<string, Bar[]>;
  cot: CotReading | null;
  /** series ids whose download failed, with the cause (shown, never swallowed) */
  seriesErrors?: Record<string, string>;
  cotError?: string;
}

export interface Component {
  id: string;
  label: string;
  /** human text of the raw input, e.g. "+2.31% vs SMA50 (4,051.20)" */
  raw: string;
  rawValue: number | null;
  score: number | null;
  direction: Direction;
  /** why it is n/a, if it is */
  missing?: string;
  /** shown for context, not scored */
  infoOnly?: boolean;
}

export interface DriverResult {
  id: DriverId;
  label: string;
  baseWeight: number;
  /** weight actually used = baseWeight × walk-forward multiplier (0 for display-only drivers) */
  weight: number;
  /** 1 = kept by the walk-forward test, 0 = no demonstrated edge */
  multiplier: number;
  displayOnly: boolean;
  score: number | null;
  direction: Direction;
  /** share of the driver's components that had data, 0..1 */
  completeness: number;
  components: Component[];
  note?: string;
}

export interface Flip { text: string }

export interface LeanResult {
  instrumentId: string;
  label: LeanLabel;
  /** weighted composite in [-1, 1] over available drivers */
  composite: number | null;
  /** 0-100 = round(100 × signAgreement × completeness): share of weighted drivers pointing the same way. NOT a probability of being right. */
  driverAgreement: number;
  /** 0..1 = |Σ w·s| / Σ w·|s| */
  signAgreement: number;
  completeness: number;
  drivers: DriverResult[];
  confirmers: { agree: number; against: number; neutral: number; total: number };
  flips: Flip[];
  freshness: { ownLastBar: string | null; seriesLastBar: Record<string, string | null>; cotAsOf: string | null };
  warnings: string[];
}
