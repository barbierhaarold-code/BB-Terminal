import { useEffect, useRef } from "react";
import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { cn } from "@/lib/cn";
import { useCointegration } from "./useCointegration";

const WINDOW = 20;
const BANDS = [2, -2, 1, -1, 0] as const;

/** Rolling z-score of a series over `window` points (undefined until the
 * window has filled and stdev is non-zero). */
function rollingZScore(values: number[], window: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    out[i] = std === 0 ? undefined : (values[i] - mean) / std;
  }
  return out;
}

export function ZScorePanel({ symbolA, symbolB, lookbackDays }: { symbolA: string; symbolB: string; lookbackDays: number }) {
  const { isLoading, isError, insufficientData, aligned, result } = useCointegration(symbolA, symbolB, lookbackDays);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a8a", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
      rightPriceScale: { borderColor: "#2a2a2a" },
      timeScale: { borderColor: "#2a2a2a", timeVisible: false },
      grid: { vertLines: { color: "rgba(42,42,42,0.4)" }, horzLines: { color: "rgba(42,42,42,0.4)" } },
      autoSize: true,
    });
    seriesRef.current = chart.addLineSeries({ color: "#b45cff", lineWidth: 2, priceLineVisible: false });
    for (const level of BANDS) {
      seriesRef.current.createPriceLine({
        price: level, color: level === 0 ? "#6e6e6e" : Math.abs(level) === 2 ? "#ff3b3b" : "#22ccee",
        lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: level === 0 ? "mean" : `${level > 0 ? "+" : ""}${level}σ`,
      });
    }
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  const zSeries = aligned && result
    ? aligned.a.map((v, i) => v - result.hedge_ratio * aligned.b[i])
    : undefined;
  const z = zSeries ? rollingZScore(zSeries, WINDOW) : undefined;
  const lastZ = z ? [...z].reverse().find((v) => v != null) : undefined;

  useEffect(() => {
    if (!seriesRef.current || !aligned || !z) return;
    seriesRef.current.setData(
      aligned.dates
        .map((d, i) => ({ time: Math.floor(new Date(d).getTime() / 1000) as UTCTimestamp, value: z[i] }))
        .filter((p): p is { time: UTCTimestamp; value: number } => p.value != null)
    );
    chartRef.current?.timeScale().fitContent();
  }, [aligned, z]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[11px]">
        <span className="sub-header">{symbolA} − β·{symbolB} spread, {WINDOW}d rolling z-score</span>
        {lastZ != null && (
          <span className={cn("num ml-auto font-semibold",
            Math.abs(lastZ) >= 2 ? "text-term-red" : Math.abs(lastZ) >= 1 ? "text-term-amberBright" : "text-term-green")}>
            z = {lastZ.toFixed(2)}
          </span>
        )}
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {isLoading && <Centered>LOADING…</Centered>}
        {isError && <Centered error>Failed to compute the spread — is the quant service running (./start.sh)?</Centered>}
        {insufficientData && <Centered error>Not enough overlapping trading days for this lookback.</Centered>}
      </div>
    </div>
  );
}

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={cn("absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest pointer-events-none",
      error ? "text-term-red" : "text-term-muted")}>
      {children}
    </div>
  );
}
