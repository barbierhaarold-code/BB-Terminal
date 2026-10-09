import { describe, expect, it } from "vitest";
import { findManager, summariseHolders, summariseManager } from "./summary";
import type { ManagerPortfolio } from "./types";

const p: ManagerPortfolio = {
  cik: "0001067983", name: "Berkshire Hathaway Inc", group: "Holding company / family office",
  filing: { accession: "A", filingDate: "2026-08-14", periodOfReport: "2026-06-30" }, previousFiling: { accession: "B", filingDate: "2026-05-15", periodOfReport: "2026-03-31" },
  totalValue: 1000, positionCount: 3, newerFiling: null, exited: [],
  rows: [{ cusip: "037833100", issuer: "APPLE INC", titleOfClass: "COM", putCall: null, sharesType: "SH", shares: 150, value: 600, ticker: "AAPL", pct: 60, status: "added", prevShares: 100, sharesChangePct: 50 },
         { cusip: "191216100", issuer: "COCA COLA CO", titleOfClass: "COM", putCall: null, sharesType: "SH", shares: 100, value: 300, ticker: null, pct: 30, status: "unchanged", prevShares: 100, sharesChangePct: 0 }],
};

describe("holdings Copilot summaries", () => {
  it("carries period, filing date, change labels, the 13F limits, and no invented ticker", () => {
    const s = summariseManager(p, 5);
    expect(s).toMatchObject({ periodOfReport: "2026-06-30", filingDate: "2026-08-14", comparedWith: { periodOfReport: "2026-03-31" } });
    expect(s.topPositions[0]).toMatchObject({ ticker: "AAPL", change: "added", sharesChangePct: 50, pctOfPortfolio: 60 });
    expect(s.topPositions[1].ticker).toBeNull();
    expect(s.meta.note).toMatch(/not a real-time view and not a signal/);
    expect(s.meta.instruction).toMatch(/never a guessed ticker|never present a change as a signal/i);
  });
  it("limit is clamped to 1–25", () => {
    expect(summariseManager(p, 0).topPositions).toHaveLength(2);
    expect(summariseManager(p, 999).topPositions).toHaveLength(2);
    expect(summariseManager(p, 1).topPositions).toHaveLength(1);
  });
  it("holders summary shows the share of all reported value", () => {
    const h = summariseHolders({ cusip: "C", ticker: "BRK/B", issuer: "BERKSHIRE", totalValueAllFilers: 1000, holderCount: 2, periodOfReport: "2026-06-30", holders: [{ cik: "1", name: "A", value: 250, shares: 5 }], note: null }, 10);
    expect(h.ticker).toBe("BRK.B");
    expect(h.topHolders[0].pctOfAllReported).toBe(25);
  });
  it("finds a curated manager by name fragment or CIK and refuses ambiguity or strangers", () => {
    expect(findManager("berkshire")).toEqual({ cik: "0001067983" });
    expect(findManager("1067983")).toEqual({ cik: "0001067983" });
    expect("error" in findManager("capital")).toBe(true);   // several
    expect("error" in findManager("zzz")).toBe(true);
    expect("error" in findManager("999")).toBe(true);
  });
});
