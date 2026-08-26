import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePortfolioEquityCurve } from "./usePortfolioEquityCurve";

function toTime(dateIso: string): UTCTimestamp {
  return Math.floor(new Date(dateIso + "T00:00:00Z").getTime() / 1000) as UTCTimestamp;
}

export function PerformanceChart() {
  const { positions, earliestDate, portfolioSeries, benchSeries, isLoading, isError, benchmark } = usePortfolioEquityCurve();

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const portSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const benchSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a8a", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
      rightPriceScale: { borderColor: "#2a2a2a" },
      timeScale: { borderColor: "#2a2a2a", timeVisible: false },
      grid: { vertLines: { color: "rgba(42,42,42,0.4)" }, horzLines: { color: "rgba(42,42,42,0.4)" } },
      autoSize: true,
    });
    portSeriesRef.current = chart.addLineSeries({ color: "#b45cff", lineWidth: 2, title: "Portfolio", priceLineVisible: false });
    benchSeriesRef.current = chart.addLineSeries({ color: "#8a8a8a", lineWidth: 1, title: benchmark, priceLineVisible: false });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; portSeriesRef.current = null; benchSeriesRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!portSeriesRef.current || !benchSeriesRef.current) return;
    portSeriesRef.current.setData(portfolioSeries.map((s) => ({ time: toTime(s.date), value: s.value })));
    benchSeriesRef.current.setData(benchSeries.map((s) => ({ time: toTime(s.date), value: s.value })));
    chartRef.current?.timeScale().fitContent();
  }, [portfolioSeries, benchSeries]);

  const portReturn = portfolioSeries.length > 0 ? portfolioSeries[portfolioSeries.length - 1].value - 100 : undefined;
  const benchReturn = benchSeries.length > 0 ? benchSeries[benchSeries.length - 1].value - 100 : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-4 flex-wrap px-3 py-1.5 border-b border-term-border bg-term-panel2 text-[11px]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2" style={{ background: "#b45cff" }} /> Portfolio <span className={cn("num", (portReturn ?? 0) >= 0 ? "up" : "down")}>{fmtPct(portReturn)}</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2" style={{ background: "#8a8a8a" }} /> {benchmark} <span className={cn("num", (benchReturn ?? 0) >= 0 ? "up" : "down")}>{fmtPct(benchReturn)}</span></span>
        <span className="ml-auto text-term-muted">since {earliestDate || "—"} · 100 = cost basis</span>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {positions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-muted pointer-events-none">
            No positions yet.
          </div>
        )}
        {positions.length > 0 && isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-muted pointer-events-none">
            Loading performance…
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-red pointer-events-none">
            Failed to load price history.
          </div>
        )}
      </div>
    </div>
  );
}
