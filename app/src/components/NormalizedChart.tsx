import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { useQueries } from "@tanstack/react-query";
import { fetchHistorical, type Candle } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtPct } from "@/lib/format";

// Tracking ETFs for the four major US indices (ETFs trade intraday, so the
// "Today" range works; the indices themselves are illiquid intraday via yfinance).
const SERIES = [
  { sym: "SPY", name: "S&P 500",   color: "#cd93ff" },
  { sym: "QQQ", name: "Nasdaq 100", color: "#22ccee" },
  { sym: "DIA", name: "Dow 30",    color: "#22ee22" },
  { sym: "IWM", name: "Russell 2k", color: "#ffb020" },
];

interface RangeDef { label: string; days: number; interval: string; ytd?: boolean; }
const RANGES: RangeDef[] = [
  { label: "Today", days: 1,        interval: "5m" },
  { label: "1W",    days: 7,        interval: "1d" },
  { label: "1M",    days: 30,       interval: "1d" },
  { label: "3M",    days: 90,       interval: "1d" },
  { label: "YTD",   days: 365,      interval: "1d", ytd: true },
  { label: "1Y",    days: 365,      interval: "1d" },
  { label: "3Y",    days: 365 * 3,  interval: "1W" },
  { label: "5Y",    days: 365 * 5,  interval: "1W" },
];

/** Normalize a candle series to % change from its first close. */
function normalize(data: Candle[] | undefined): { time: UTCTimestamp; value: number }[] {
  if (!data || data.length === 0) return [];
  const base = data[0].close;
  if (!base) return [];
  return data.map((c) => ({
    time: Math.floor(new Date(c.date).getTime() / 1000) as UTCTimestamp,
    value: (c.close / base - 1) * 100,
  }));
}

export function NormalizedChart() {
  const [range, setRange] = useState<RangeDef>(RANGES[2]); // default 1M
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(SERIES.map((s) => [s.sym, true]))
  );

  const startDate = useMemo(() => {
    if (range.ytd) return `${new Date().getFullYear()}-01-01`;
    return new Date(Date.now() - range.days * 864e5).toISOString().slice(0, 10);
  }, [range]);

  const queries = useQueries({
    queries: SERIES.map((s) => ({
      queryKey: ["norm", s.sym, range.label],
      queryFn: () => fetchHistorical(s.sym, { interval: range.interval, start_date: startDate }),
      staleTime: 60_000,
      refetchInterval: range.label === "Today" ? 60_000 : undefined,
    })),
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});

  // Build chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a8a", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
      rightPriceScale: { borderColor: "#2a2a2a" },
      timeScale: { borderColor: "#2a2a2a", timeVisible: false },
      grid: { vertLines: { color: "rgba(42,42,42,0.4)" }, horzLines: { color: "rgba(42,42,42,0.4)" } },
      crosshair: {
        vertLine: { color: "#b45cff", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#b45cff" },
        horzLine: { color: "#b45cff", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#b45cff" },
      },
      autoSize: true,
    });
    // Zero baseline reference.
    for (const s of SERIES) {
      seriesRef.current[s.sym] = chart.addLineSeries({
        color: s.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: "custom", formatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
      });
    }
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = {}; };
  }, []);

  // Push data whenever any query resolves.
  useEffect(() => {
    for (let i = 0; i < SERIES.length; i++) {
      const s = SERIES[i];
      const series = seriesRef.current[s.sym];
      if (!series) continue;
      series.setData(normalize(queries[i].data));
    }
    chartRef.current?.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join(","), range.label]);

  // Toggle visibility.
  useEffect(() => {
    for (const s of SERIES) {
      seriesRef.current[s.sym]?.applyOptions({ visible: visible[s.sym] });
    }
  }, [visible]);

  const anyLoading = queries.some((q) => q.isLoading);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-2 h-7 border-b border-term-border bg-term-panel2 gap-3 flex-wrap">
        {/* Line toggles */}
        <div className="flex items-center gap-3">
          {SERIES.map((s) => {
            const idx = SERIES.indexOf(s);
            const last = normalize(queries[idx].data).slice(-1)[0]?.value;
            return (
              <button key={s.sym} onClick={() => setVisible((v) => ({ ...v, [s.sym]: !v[s.sym] }))}
                className={cn("flex items-center gap-1.5 text-[10px] uppercase tracking-wider",
                  visible[s.sym] ? "opacity-100" : "opacity-35")}>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                <span className="text-term-heading">{s.name}</span>
                {last != null && (
                  <span className={cn("num", last >= 0 ? "up" : "down")}>{fmtPct(last)}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* Range toggles */}
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider">
          {RANGES.map((r) => (
            <button key={r.label} onClick={() => setRange(r)}
              className={cn("px-1.5 py-0.5 border",
                r.label === range.label
                  ? "border-term-amber text-term-amber"
                  : "border-transparent text-term-muted hover:text-term-text")}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {anyLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-muted pointer-events-none">
            LOADING…
          </div>
        )}
      </div>
    </div>
  );
}
