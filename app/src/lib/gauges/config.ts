// ────────────────────────────────────────────────────────────
// Vol & Currency Strength (GAUGES) — definitions. Daily closes come from the existing cached Yahoo proxy
// (/api, OpenBB yfinance); no new paid source, never the Twelve Data quota. Descriptive only.
// ────────────────────────────────────────────────────────────

export interface VolIndexDef { id: string; label: string; yahoo: string; measures: string }

export const VOL_INDICES: VolIndexDef[] = [
  { id: "VIX", label: "VIX", yahoo: "^VIX", measures: "30-day implied volatility of the S&P 500 (Cboe)" },
  { id: "VXN", label: "VXN", yahoo: "^VXN", measures: "30-day implied volatility of the Nasdaq-100 (Cboe)" },
  { id: "GVZ", label: "GVZ", yahoo: "^GVZ", measures: "30-day implied volatility of gold, from GLD options (Cboe)" },
  { id: "OVX", label: "OVX", yahoo: "^OVX", measures: "30-day implied volatility of crude oil, from USO options (Cboe)" },
  { id: "MOVE", label: "MOVE", yahoo: "^MOVE", measures: "implied volatility of US Treasury yields, 1-month options (ICE BofA MOVE Index)" },
];

export type Ccy = "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CAD" | "CHF" | "NZD";
export const CURRENCIES: Ccy[] = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];

/** The seven USD majors. `base` is the currency whose value is quoted in the other. */
export interface PairDef { id: string; yahoo: string; base: Ccy; quote: Ccy }
export const PAIRS: PairDef[] = [
  { id: "EURUSD", yahoo: "EURUSD=X", base: "EUR", quote: "USD" },
  { id: "GBPUSD", yahoo: "GBPUSD=X", base: "GBP", quote: "USD" },
  { id: "AUDUSD", yahoo: "AUDUSD=X", base: "AUD", quote: "USD" },
  { id: "NZDUSD", yahoo: "NZDUSD=X", base: "NZD", quote: "USD" },
  { id: "USDJPY", yahoo: "USDJPY=X", base: "USD", quote: "JPY" },
  { id: "USDCAD", yahoo: "USDCAD=X", base: "USD", quote: "CAD" },
  { id: "USDCHF", yahoo: "USDCHF=X", base: "USD", quote: "CHF" },
];

export const LOOKBACKS = [1, 5, 20] as const;
export type Lookback = (typeof LOOKBACKS)[number];

/** Calendar windows for the percentiles. */
export const WINDOW_1Y_DAYS = 365;
export const WINDOW_5Y_DAYS = 5 * 365 + 1;
/** A percentile window is reported only if the series reaches back at least this close to the window start (days). */
export const WINDOW_START_TOLERANCE_DAYS = 10;
/** A pair whose latest close is older than the newest pair's by more than this many calendar days is left out. */
export const STALE_PAIR_DAYS = 1;

export const PERCENTILE_DEFINITION =
  "Percentile = the share of daily closes in the window (the last 1 or 5 calendar years up to and including the latest close) that are at or below the latest close, in percent. "
  + "A reading of 90 means the latest level is at or above 90% of the window's closes. It describes where the level sits in its own history; it is not a prediction.";

export const CHANGE_DEFINITION = "1-day and 5-day change = the latest close minus the close 1 or 5 trading days earlier (in index points), with the percent change of the level beside it.";

export const STRENGTH_FORMULA =
  "For each pair p over N trading days: r(p) = ln(close_t / close_t−N). Each currency c's move against the US dollar is x(c) = r(c/USD) (for USD/JPY, USD/CAD and USD/CHF the sign is reversed), and x(USD) = 0. "
  + "The cross rate c/d then moves by x(c) − x(d), exactly (triangular identity), so no cross-pair data is needed. "
  + "Strength(c, N) = the average of x(c) − x(d) over the other currencies d, in percent. "
  + "It is a relative-performance description over the window: it ranks currencies against each other and says nothing about what happens next.";

export const GAUGES_NOTE =
  "Daily closes from Yahoo Finance through the terminal's cached proxy. Volatility indices are implied volatilities published by Cboe and ICE; percentiles and changes are computed here from the daily closes shown. "
  + "Currency strength is a transparent relative-performance index from daily closes of the seven USD major pairs. Nothing here is a forecast, a signal or advice.";

/** Shown wherever the newest daily bar is dated today (the session is still in progress, so it is not a final close). */
export const INTRADAY_LABEL = "intraday (session in progress)";
export const COMPLETED_LABEL = "completed session close";
