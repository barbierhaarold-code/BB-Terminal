import { useQueries } from "@tanstack/react-query";
import { fetchHistorical, type Candle } from "@/lib/api";

// ────────────────────────────────────────────────────────────
// GICS sectors — the single source of truth for sector performance.
// Both the CC sector panel (part C) and the Heatmap sector rollup (part G)
// read from `useSectorPerformance()`, so the two views always agree.
// ────────────────────────────────────────────────────────────

export interface SectorDef {
  /** GICS sector name, matching the `sector` field in the constituent JSON. */
  name: string;
  /** SPDR sector ETF used as the live proxy for the sector's daily move. */
  etf: string;
}

export const SECTORS: SectorDef[] = [
  { name: "Information Technology", etf: "XLK" },
  { name: "Health Care", etf: "XLV" },
  { name: "Financials", etf: "XLF" },
  { name: "Consumer Discretionary", etf: "XLY" },
  { name: "Communication Services", etf: "XLC" },
  { name: "Industrials", etf: "XLI" },
  { name: "Consumer Staples", etf: "XLP" },
  { name: "Energy", etf: "XLE" },
  { name: "Utilities", etf: "XLU" },
  { name: "Real Estate", etf: "XLRE" },
  { name: "Materials", etf: "XLB" },
];

export const SECTOR_BY_NAME: Record<string, SectorDef> = Object.fromEntries(
  SECTORS.map((s) => [s.name, s])
);

export interface SectorPerf {
  def: SectorDef;
  changePct?: number;
  isLoading: boolean;
}

function chgFromCandles(data: Candle[] | undefined): number | undefined {
  if (!data || data.length < 2) return undefined;
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  return ((last.close - prev.close) / prev.close) * 100;
}

/**
 * Live daily % change for all 11 GICS sectors via their SPDR ETFs
 * (close-over-close, matching the WEI/CC convention). Sorted ranking is left
 * to the caller so different views can rank or group as they need.
 */
export function useSectorPerformance(): SectorPerf[] {
  const queries = useQueries({
    queries: SECTORS.map((s) => ({
      queryKey: ["sector-etf", s.etf],
      queryFn: () => fetchHistorical(s.etf, {
        start_date: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10),
      }),
      refetchInterval: 120_000,
      staleTime: 60_000,
    })),
  });
  return SECTORS.map((def, i) => ({
    def,
    changePct: chgFromCandles(queries[i].data),
    isLoading: queries[i].isLoading,
  }));
}

// ────────────────────────────────────────────────────────────
// Sector rotation (QUANT > Sector Rotation tab) — same 11 SECTORS above
// (single source of truth, not re-declared), but needs 6 months of daily
// history per ETF to derive multi-period returns, vs. `useSectorPerformance`
// above which only pulls the last week for a 1-day change. Different query,
// same source list — not a refetch of what CC/HEAT already have cached
// (their queryKey/window is `["sector-etf", etf]` over 7 days; this uses a
// distinct key so it doesn't fight that cache for a different date range).
// ────────────────────────────────────────────────────────────

export interface RotationPeriod { label: string; days: number; }
export const ROTATION_PERIODS: RotationPeriod[] = [
  { label: "1D", days: 1 },
  { label: "1W", days: 5 },
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
];

export interface SectorRotationRow {
  def: SectorDef;
  returns: (number | undefined)[]; // aligned to ROTATION_PERIODS
  isLoading: boolean;
}

/** % change from N trading days ago to the latest close. */
function returnOverDays(data: Candle[] | undefined, days: number): number | undefined {
  if (!data || data.length < days + 1) return undefined;
  const last = data[data.length - 1].close;
  const base = data[data.length - 1 - days].close;
  return base ? ((last - base) / base) * 100 : undefined;
}

export function useSectorRotation(): SectorRotationRow[] {
  const queries = useQueries({
    queries: SECTORS.map((s) => ({
      queryKey: ["sector-rotation-etf", s.etf],
      queryFn: () => fetchHistorical(s.etf, {
        start_date: new Date(Date.now() - 130 * 864e5).toISOString().slice(0, 10),
      }),
      staleTime: 5 * 60_000,
      refetchInterval: 5 * 60_000,
    })),
  });
  return SECTORS.map((def, i) => ({
    def,
    returns: ROTATION_PERIODS.map((p) => returnOverDays(queries[i].data, p.days)),
    isLoading: queries[i].isLoading,
  }));
}
