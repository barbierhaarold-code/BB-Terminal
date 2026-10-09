// ────────────────────────────────────────────────────────────
// Institutional Holdings (HOLD) — shared types. Source: SEC Form 13F-HR (official bulk data sets +
// data.sec.gov submissions JSON). Descriptive only: 13F is long US-listed positions at quarter end,
// filed up to 45 days later. Not a real-time view and not a signal.
// ────────────────────────────────────────────────────────────

export type PutCall = "Put" | "Call" | null;
export type ChangeStatus = "new" | "added" | "reduced" | "unchanged" | "exited" | "unknown";

/** One aggregated position (all rows of the filing with the same CUSIP and put/call flag are summed). */
export interface Position {
  cusip: string;
  issuer: string;
  titleOfClass: string;
  putCall: PutCall;
  sharesType: "SH" | "PRN";
  shares: number;
  /** market value in US dollars, as reported (13F reports whole dollars since 3 Jan 2023) */
  value: number;
}

export interface HoldingRow extends Position {
  /** ticker only when the CUSIP→ticker match is exact and high-confidence; otherwise null (never guessed) */
  ticker: string | null;
  /** share of the filing's total reported value, 0–100 */
  pct: number;
  status: ChangeStatus;
  prevShares: number | null;
  /** (shares − prevShares) / prevShares × 100, null for new / exited / unknown */
  sharesChangePct: number | null;
}

export interface ManagerRef { cik: string; name: string; group: "Hedge fund" | "Asset manager" | "Holding company / family office" | "Sovereign fund" | "Activist" }

export interface FilingRef { accession: string; filingDate: string; periodOfReport: string }

export interface ManagerPortfolio {
  cik: string;
  name: string;
  group: ManagerRef["group"];
  filing: FilingRef;
  previousFiling: FilingRef | null;
  totalValue: number;
  positionCount: number;
  /** top positions by value (capped); `positionCount` is the true count */
  rows: HoldingRow[];
  /** positions held at the previous quarter-end and gone now (top by previous value, capped) */
  exited: HoldingRow[];
  /** set when data.sec.gov lists a newer 13F-HR than the bulk data set carries */
  newerFiling: FilingRef | null;
}

export interface Holder { cik: string; name: string; value: number; shares: number }
export interface HolderList { cusip: string; ticker: string; issuer: string; totalValueAllFilers: number; holderCount: number; holders: Holder[]; periodOfReport: string }

export type HoldStatus =
  | { state: "missing_contact"; message: string }
  | { state: "idle" | "building" | "mapping" | "ready" | "error"; phase: string; message?: string; builtAt: string | null; mapping: { done: number; total: number }; latestPeriod: string | null; dataSets: string[] };

export interface ManagerListItem { cik: string; name: string; group: ManagerRef["group"]; filing: FilingRef; totalValue: number; positionCount: number; newerFiling: FilingRef | null }
