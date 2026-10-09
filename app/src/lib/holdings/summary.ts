import { MANAGERS, THIRTEEN_F_NOTE } from "./config";
import { displayTicker } from "./math";
import type { HolderList, ManagerListItem, ManagerPortfolio } from "./types";

// Read-only, serialisable summaries for the Copilot (same numbers as the HOLD page, built from the same server payloads).

const round = (n: number | null, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const META = {
  note: THIRTEEN_F_NOTE,
  instruction: "Always state the period of report and the filing date next to any figure. Say these are weeks-old quarter-end positions, not current holdings, and never present a change as a signal or recommendation. A position without a ticker has no confirmed CUSIP match: quote the issuer name and CUSIP, never a guessed ticker.",
};

export function summariseManagerList(latestPeriod: string, list: ManagerListItem[]) {
  return {
    available: true as const,
    latestPeriod,
    managers: list.map((m) => ({ name: m.name, cik: m.cik, type: m.group, periodOfReport: m.filing.periodOfReport, filingDate: m.filing.filingDate, reportedTotalUsd: m.totalValue, positions: m.positionCount, newerFilingOnSec: m.newerFiling ? { periodOfReport: m.newerFiling.periodOfReport, filingDate: m.newerFiling.filingDate } : null })),
    meta: META,
  };
}

export function summariseManager(p: ManagerPortfolio, limit: number) {
  const n = Math.max(1, Math.min(25, Math.floor(limit) || 10));
  return {
    available: true as const,
    manager: p.name, cik: p.cik, type: p.group,
    periodOfReport: p.filing.periodOfReport, filingDate: p.filing.filingDate, accession: p.filing.accession,
    comparedWith: p.previousFiling ? { periodOfReport: p.previousFiling.periodOfReport, filingDate: p.previousFiling.filingDate } : null,
    reportedTotalUsd: p.totalValue, positions: p.positionCount,
    newerFilingOnSec: p.newerFiling ? { periodOfReport: p.newerFiling.periodOfReport, filingDate: p.newerFiling.filingDate } : null,
    topPositions: p.rows.slice(0, n).map((r) => ({
      issuer: r.issuer, ticker: r.ticker ? displayTicker(r.ticker) : null, cusip: r.cusip, class: r.titleOfClass, option: r.putCall,
      shares: r.shares, valueUsd: r.value, pctOfPortfolio: round(r.pct), change: r.status, previousShares: r.prevShares, sharesChangePct: round(r.sharesChangePct, 1),
    })),
    exitedSincePreviousQuarter: p.exited.slice(0, 10).map((r) => ({ issuer: r.issuer, ticker: r.ticker ? displayTicker(r.ticker) : null, cusip: r.cusip, previousShares: r.prevShares })),
    meta: META,
  };
}

export function summariseHolders(h: HolderList & { note: string | null }, limit: number) {
  const n = Math.max(1, Math.min(25, Math.floor(limit) || 10));
  return {
    available: true as const,
    ticker: displayTicker(h.ticker), issuer: h.issuer, cusip: h.cusip, periodOfReport: h.periodOfReport,
    filersHoldingIt: h.holderCount, totalReportedValueUsd: h.totalValueAllFilers,
    topHolders: h.holders.slice(0, n).map((x) => ({ holder: x.name, cik: x.cik, shares: x.shares, valueUsd: x.value, pctOfAllReported: h.totalValueAllFilers ? round((x.value / h.totalValueAllFilers) * 100) : null })),
    note: h.note,
    meta: META,
  };
}

/** Resolves a manager name fragment or CIK to a curated manager; null if none or ambiguous. */
export function findManager(q: string): { cik: string } | { error: string } {
  const s = q.trim().toLowerCase();
  if (!s) return { error: "Empty manager." };
  const digits = s.replace(/\D/g, "");
  if (digits && /^\d+$/.test(s)) { const m = MANAGERS.find((x) => Number(x.cik) === Number(digits)); return m ? { cik: m.cik } : { error: `CIK ${s} is not one of the curated managers.` }; }
  const hits = MANAGERS.filter((m) => m.name.toLowerCase().includes(s));
  if (hits.length === 1) return { cik: hits[0].cik };
  if (hits.length === 0) return { error: `No curated manager matches "${q}". Curated: ${MANAGERS.map((m) => m.name).join("; ")}.` };
  return { error: `"${q}" matches several managers: ${hits.map((m) => m.name).join("; ")}. Be more specific.` };
}
