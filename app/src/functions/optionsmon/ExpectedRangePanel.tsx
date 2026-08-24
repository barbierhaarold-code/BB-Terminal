import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import { fetchHistorical, type OptionsRow } from "@/lib/api";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useOptionsChain } from "./useOptionsChain";
import { atmIv } from "./chainMath";

interface Horizon { label: string; minDte: number; }
const HORIZONS: Horizon[] = [
  { label: "1W", minDte: 7 },
  { label: "1M", minDte: 30 },
];

function pickExpiry(rows: OptionsRow[], minDte: number): { expiration: string; dte: number } | null {
  const byExp = new Map<string, number>();
  for (const r of rows) byExp.set(r.expiration, r.dte);
  const entries = Array.from(byExp.entries()).sort((a, b) => a[1] - b[1]);
  const candidate = entries.find(([, dte]) => dte >= minDte);
  const chosen = candidate ?? entries[entries.length - 1];
  return chosen ? { expiration: chosen[0], dte: chosen[1] } : null;
}

interface HorizonStats { label: string; dte: number; iv: number; moveDollar: number; movePct: number; }

export function ExpectedRangePanel({ symbol }: { symbol: string }) {
  const { data: chain, isLoading: chainLoading, error: chainError, underlying } = useOptionsChain(symbol);

  const startDate = useMemo(() => new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10), []);
  const { data: candles = [], isLoading: candlesLoading, error: candlesError } = useQuery({
    queryKey: ["historical-6mo", symbol],
    queryFn: () => fetchHistorical(symbol, { interval: "1d", start_date: startDate }),
    staleTime: 60_000,
  });

  const [coneHorizon, setConeHorizon] = useState<string>("1M");

  const stats: HorizonStats[] = useMemo(() => {
    if (!underlying || chain.length === 0) return [];
    const out: HorizonStats[] = [];
    for (const h of HORIZONS) {
      const picked = pickExpiry(chain, h.minDte);
      if (!picked) continue;
      const iv = atmIv(chain, picked.expiration, underlying);
      if (iv == null) continue;
      const T = picked.dte / 365;
      const movePct = iv * Math.sqrt(T) * 100;
      const moveDollar = underlying * (movePct / 100);
      out.push({ label: h.label, dte: picked.dte, iv, moveDollar, movePct });
    }
    return out;
  }, [chain, underlying]);

  const activeStat = stats.find((s) => s.label === coneHorizon) ?? stats[0];

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const coneSeriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});

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
    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: "#22ee22", downColor: "#ff3b3b", borderVisible: false,
      wickUpColor: "#22ee22", wickDownColor: "#ff3b3b",
    });
    const mkLine = (opacity: number) => chart.addLineSeries({
      color: `rgba(180,92,255,${opacity})`, lineWidth: 2, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    coneSeriesRef.current = {
      up1: mkLine(0.9), down1: mkLine(0.9),
      up2: mkLine(0.45), down2: mkLine(0.45),
    };
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; candleSeriesRef.current = null; coneSeriesRef.current = {}; };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(candles.map((c) => ({
      time: Math.floor(new Date(c.date).getTime() / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const lines = coneSeriesRef.current;
    if (!lines.up1 || candles.length === 0 || !activeStat) return;
    const last = candles[candles.length - 1];
    const startTime = Math.floor(new Date(last.date).getTime() / 1000) as UTCTimestamp;
    const endTime = (startTime + activeStat.dte * 86400) as UTCTimestamp;
    const price = last.close;
    const move1 = activeStat.moveDollar;
    const move2 = move1 * 2;
    lines.up1.setData([{ time: startTime, value: price }, { time: endTime, value: price + move1 }]);
    lines.down1.setData([{ time: startTime, value: price }, { time: endTime, value: price - move1 }]);
    lines.up2.setData([{ time: startTime, value: price }, { time: endTime, value: price + move2 }]);
    lines.down2.setData([{ time: startTime, value: price }, { time: endTime, value: price - move2 }]);
    chartRef.current?.timeScale().fitContent();
  }, [candles, activeStat]);

  const isLoading = chainLoading || candlesLoading;
  const error = chainError || candlesError;
  const empty = !isLoading && !error && stats.length === 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-6 px-3 h-9 border-b border-term-border bg-term-panel2 text-[11px] uppercase tracking-wider overflow-x-auto scroll-thin">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-2 shrink-0">
            <span className="text-term-muted">{s.label} MOVE</span>
            <span className="text-term-heading num">{fmtPrice(s.moveDollar)}</span>
            <span className="text-term-muted num">({fmtPct(s.movePct)})</span>
          </div>
        ))}
        {activeStat && (
          <div className="flex items-baseline gap-2 shrink-0">
            <span className="text-term-muted">ATM IV ({activeStat.label})</span>
            <span className="text-term-amber num font-bold">{(activeStat.iv * 100).toFixed(1)}%</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <span className="text-term-muted mr-1">CONE</span>
          {HORIZONS.map((h) => (
            <button key={h.label} onClick={() => setConeHorizon(h.label)}
              className={cn("px-2 py-0.5 border num",
                h.label === coneHorizon ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {h.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {isLoading && <Centered>Loading expected range…</Centered>}
        {!isLoading && error && <Centered error>{(error as Error).message}</Centered>}
        {empty && <Centered>No options chain available to compute expected range.</Centered>}
      </div>
      <div className="px-3 py-1 border-t border-term-border sub-header">
        DASHED CONE = ±1σ / ±2σ EXPECTED RANGE FROM ATM IV, sqrt(TIME) SCALING
      </div>
    </div>
  );
}

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={cn(
      "absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest pointer-events-none",
      error ? "text-term-red" : "text-term-muted"
    )}>
      {children}
    </div>
  );
}
