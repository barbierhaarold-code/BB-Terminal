import type { CotFreshness } from "./cotMath";
import type { CotGroup, CotReportType } from "./cotContracts";

/** Where the numbers came from. "tradingster-fallback" is shown with a visible banner everywhere, never silently. */
export type CotSource = "cftc" | "tradingster-fallback";

export interface CotCategoryRow {
  id: string;
  label: string;
  long: number;
  short: number;
  /** long − short (spreading positions excluded, as in CFTC's own net convention) */
  net: number;
  changeLong: number | null;
  changeShort: number | null;
  changeNet: number | null;
  /** percentile rank of `net` over the last 156 / 260 weekly reports; null = not enough history */
  pct3y: number | null;
  pct5y: number | null;
}

export interface CotContractOk {
  available: true;
  key: string;
  name: string;
  short: string;
  group: CotGroup;
  code: string;
  report: CotReportType;
  /** CFTC's own market_and_exchange_names string */
  market: string;
  /** Tuesday (YYYY-MM-DD) these positions are as of */
  asOf: string;
  openInterest: number;
  openInterestChange: number | null;
  /** id of the category treated as the headline speculative group */
  primary: string;
  categories: CotCategoryRow[];
  /** number of weekly reports available for this contract inside the fetched window */
  weeks: number;
}

export interface CotContractMissing {
  available: false;
  key: string;
  name: string;
  short: string;
  group: CotGroup;
  code: string;
  report: CotReportType;
  reason: string;
}

export type CotContract = CotContractOk | CotContractMissing;

export interface CotDiagnostics {
  /** upstream round-trips to the official CFTC API since the server started (one per cache refresh, however many callers) */
  officialFetches: number;
  /** times the Tradingster fallback was used since the server started */
  fallbackHits: number;
  lastFallbackAt: string | null;
  officialFailures: number;
  lastOfficialError: string | null;
}

export interface CotSnapshot {
  source: CotSource;
  sourceLabel: string;
  basis: "futures-only";
  fetchedAt: string;
  /** newest asOf across contracts */
  asOf: string | null;
  freshness: CotFreshness | null;
  contracts: CotContract[];
  /** human-readable caveats: stale cache, fallback in use, contracts at an older date… */
  warnings: string[];
  stale: boolean;
  diagnostics: CotDiagnostics;
}

export interface CotHistoryPoint {
  /** YYYY-MM-DD (Tuesday) */
  date: string;
  openInterest: number;
  /** net position per category id */
  nets: Record<string, number>;
}

export interface CotHistory {
  key: string;
  history: CotHistoryPoint[];
}

export interface CotPercentileParams { y3: number; y5: number }
