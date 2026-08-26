import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchHistorical, type Candle } from "@/lib/api";
import { usePortfolio } from "@/store/portfolioStore";
import { buildEquityCurve, indexToCostBasis, type SeriesPoint } from "@/lib/portfolio";

const BENCHMARK = "SPY";

/** Re-base a series to 100 at the date the *other* series' data begins, so
 * a benchmark with a longer history doesn't get compared from a different
 * start point than the portfolio actually has. */
function rebaseFrom(series: SeriesPoint[], fromDate: string): SeriesPoint[] {
  const start = series.find((s) => s.date >= fromDate) ?? series[0];
  if (!start || !start.value) return series.map((s) => ({ date: s.date, value: 100 }));
  return series.map((s) => ({ date: s.date, value: (s.value / start.value) * 100 }));
}

/**
 * Shared data layer behind the Performance and Risk tabs — both need the
 * same "daily portfolio value since first position, indexed to the book's
 * running cost basis (100 = break-even), plus SPY over the same window"
 * series, fetched from each position's own entry date forward (see
 * buildEquityCurve / indexToCostBasis).
 */
export function usePortfolioEquityCurve() {
  const positions = usePortfolio((s) => s.positions);
  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions]);
  const earliestDate = useMemo(
    () => positions.reduce((min, p) => (p.date < min ? p.date : min), positions[0]?.date ?? ""),
    [positions]
  );

  const histQs = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ["portfolio-perf-hist", s, earliestDate],
      queryFn: () => fetchHistorical(s, { interval: "1d", start_date: earliestDate }),
      enabled: !!earliestDate,
      staleTime: 5 * 60_000,
    })),
  });
  const [benchQ] = useQueries({
    queries: [{
      queryKey: ["portfolio-perf-bench", earliestDate],
      queryFn: () => fetchHistorical(BENCHMARK, { interval: "1d", start_date: earliestDate }),
      enabled: !!earliestDate,
      staleTime: 5 * 60_000,
    }],
  });

  const isLoading = histQs.some((q) => q.isLoading) || benchQ.isLoading;
  const isError = histQs.some((q) => q.isError) || benchQ.isError;

  const portfolioSeries = useMemo(() => {
    const historyBySymbol = new Map<string, Candle[]>();
    symbols.forEach((s, i) => historyBySymbol.set(s, (histQs[i].data as Candle[] | undefined) ?? []));
    return indexToCostBasis(buildEquityCurve(positions, historyBySymbol), positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, symbols, histQs.map((q) => q.dataUpdatedAt).join(",")]);

  const benchSeries = useMemo(() => {
    const raw = (benchQ.data as Candle[] | undefined) ?? [];
    const series = raw.map((c) => ({ date: c.date.slice(0, 10), value: c.close }));
    return portfolioSeries.length > 0 ? rebaseFrom(series, portfolioSeries[0].date) : [];
  }, [benchQ.data, portfolioSeries]);

  return { positions, earliestDate, portfolioSeries, benchSeries, isLoading, isError, benchmark: BENCHMARK };
}
