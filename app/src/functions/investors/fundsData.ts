import { useQuery } from "@tanstack/react-query";
import { fetch13F, type Holding13F } from "@/lib/api";
import { UNIVERSE, type Constituent } from "@/lib/universe";
import { FUND_UNIVERSE, type FundEntry } from "./fundUniverse";

export interface FundHoldingsData {
  fund: FundEntry;
  holdings: Holding13F[];
  asOf: string;
  totalValue: number;
}

/**
 * Every fund's latest 13F snapshot, fetched once and shared by the Funds
 * and Portfolios/Ranking tabs (per the phase spec: "reuse the Funds tab's
 * data layer"). A failed fund degrades to an empty holdings list rather
 * than failing the whole ranking — a partial board beats none, same
 * reasoning as fetchQuotes's per-chunk catch.
 */
export function useAllFundHoldings() {
  return useQuery({
    queryKey: ["invest-13f-all"],
    queryFn: async (): Promise<FundHoldingsData[]> =>
      Promise.all(
        FUND_UNIVERSE.map(async (fund): Promise<FundHoldingsData> => {
          try {
            const holdings = await fetch13F(fund.cik, { limit: 1 });
            const totalValue = holdings.reduce((a, h) => a + (h.value || 0), 0);
            const asOf = holdings[0]?.period_ending ?? "";
            return { fund, holdings, asOf, totalValue };
          } catch {
            return { fund, holdings: [], asOf: "", totalValue: 0 };
          }
        })
      ),
    staleTime: 55 * 60_000,
  });
}

export interface FundRanking extends FundHoldingsData {
  holdingsCount: number;
  top20Concentration: number;
}

export function rankFunds(all: FundHoldingsData[]): FundRanking[] {
  return all
    .map((f) => {
      const sorted = [...f.holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
      const top20Value = sorted.slice(0, 20).reduce((a, h) => a + (h.value || 0), 0);
      return {
        ...f,
        holdingsCount: f.holdings.length,
        top20Concentration: f.totalValue > 0 ? top20Value / f.totalValue : 0,
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);
}

// ────── Issuer name → ticker/sector matching ──────
// 13F filings report each position by issuer name + CUSIP, not ticker — SEC's
// free tier has no CUSIP→ticker map (verified: `symbol_map` only resolves
// CIKs). Approximate by normalizing both sides (uppercase, strip punctuation
// and common corporate suffixes) and matching on the resulting stem. This
// under-matches on purpose (ADRs, share classes, bonds, private placements,
// foreign issuers outside the tracked S&P/Nasdaq/Dow universe never match) —
// unmatched value is surfaced as "Other / Unmapped", never silently dropped.
const SUFFIX_RE = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|LLC|LP|HOLDINGS?|GROUP|CL\s?[A-Z]|COM|SHS|ADR|NEW)\b/g;

function normalizeIssuer(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'&]/g, "")
    .replace(SUFFIX_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

let issuerIndex: Map<string, Constituent> | null = null;
function getIssuerIndex(): Map<string, Constituent> {
  if (issuerIndex) return issuerIndex;
  issuerIndex = new Map();
  for (const c of UNIVERSE) {
    const key = normalizeIssuer(c.name);
    if (key && !issuerIndex.has(key)) issuerIndex.set(key, c);
  }
  return issuerIndex;
}

export function matchIssuer(issuer: string): Constituent | undefined {
  return getIssuerIndex().get(normalizeIssuer(issuer));
}

/** Sector allocation for one fund's holdings, by matched market value. */
export function sectorBreakdown(holdings: Holding13F[]): { sector: string; value: number }[] {
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    const c = matchIssuer(h.issuer);
    const sector = c?.sector ?? "Other / Unmapped";
    bySector.set(sector, (bySector.get(sector) ?? 0) + (h.value || 0));
  }
  return Array.from(bySector, ([sector, value]) => ({ sector, value })).sort((a, b) => b.value - a.value);
}

/** Funds ranked by their position in one ticker — "who holds X" (Portfolios/Ranking tabs). */
export interface HolderRow { fund: FundEntry; value: number; weight: number; asOf: string; sharesHeld: number; }
export function holdersOf(all: FundHoldingsData[], symbol: string): HolderRow[] {
  const target = UNIVERSE.find((c) => c.symbol === symbol.toUpperCase());
  if (!target) return [];
  const targetKey = normalizeIssuer(target.name);
  const rows: HolderRow[] = [];
  for (const f of all) {
    const h = f.holdings.find((row) => normalizeIssuer(row.issuer) === targetKey);
    if (h) rows.push({ fund: f.fund, value: h.value || 0, weight: h.weight || 0, asOf: f.asOf, sharesHeld: h.principal_amount || 0 });
  }
  return rows.sort((a, b) => b.value - a.value);
}
