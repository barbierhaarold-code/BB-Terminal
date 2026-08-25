import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchHistorical, fetchCointegration } from "@/lib/api";
import { alignSeriesByDate } from "@/lib/correlation";

/**
 * Shared by the Cointegration and Z-Score tabs (same pair, same lookback):
 * fetches both legs' daily closes, date-aligns them, and runs the
 * Engle-Granger test once via the quant_service proxy. Both tabs read off
 * this one query instead of each re-fetching/re-testing the same pair.
 */
export function useCointegration(symbolA: string, symbolB: string, lookbackDays: number) {
  const startDate = useMemo(
    () => new Date(Date.now() - lookbackDays * 864e5).toISOString().slice(0, 10),
    [lookbackDays]
  );
  const [qa, qb] = useQueries({
    queries: [symbolA, symbolB].map((s) => ({
      queryKey: ["quant-pair-closes", s, lookbackDays],
      queryFn: () => fetchHistorical(s, { interval: "1d", start_date: startDate }),
      enabled: !!s,
      staleTime: 60_000,
    })),
  });

  const aligned = useMemo(() => {
    if (!qa.data || !qb.data) return undefined;
    const [dates, ac, bc] = alignSeriesByDate(qa.data, qb.data);
    return ac.length >= 10 ? { dates, a: ac, b: bc } : undefined;
  }, [qa.data, qb.data]);

  const cointQuery = useQuery({
    queryKey: ["quant-cointegration", symbolA, symbolB, lookbackDays, aligned?.a.length],
    queryFn: () => fetchCointegration(aligned!.a, aligned!.b),
    enabled: !!aligned,
    staleTime: 60_000,
  });

  return {
    isLoading: qa.isLoading || qb.isLoading || (!!aligned && cointQuery.isLoading),
    isError: qa.isError || qb.isError || cointQuery.isError,
    insufficientData: !!qa.data && !!qb.data && !aligned,
    aligned,
    result: cointQuery.data,
  };
}
