import type { Ccy, Lookback } from "./config";

export interface Bar { date: string; close: number }

export interface Change { points: number; pct: number | null; from: string }

export interface VolReading {
  id: string;
  label: string;
  measures: string;
  level: number;
  asOf: string;
  change1d: Change | null;
  change5d: Change | null;
  /** 0–100, null with a reason when the history does not cover the window */
  pctile1y: number | null;
  pctile5y: number | null;
  n1y: number;
  n5y: number;
  warnings: string[];
}

export interface VolFailure { id: string; label: string; error: string }

export interface StrengthRow { currency: Ccy; value: number | null; rank: number | null }
export interface StrengthResult {
  lookback: Lookback;
  rows: StrengthRow[];
  /** the common trading dates the window runs between */
  from: string | null;
  to: string | null;
}
export interface StrengthBoard {
  results: StrengthResult[];
  pairsUsed: string[];
  pairsLeftOut: Array<{ id: string; why: string }>;
  asOf: string | null;
  commonDates: number;
}
