import { useEffect, useRef } from "react";
import { createChart, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { cn } from "@/lib/cn";
import { useChartTheme, baseChartOptions, type ChartPalette } from "@/lib/chartTheme";
import { useCointegration } from "./useCointegration";

const WINDOW = 20;
const BANDS = [2, -2, 1, -1, 0] as const;

/** (Re)create the σ-band price lines with the current palette. */
function addBandLines(series: ISeriesApi<"Line">, ct: ChartPalette): IPriceLine[] {
  return BANDS.map((level) =>
    series.createPriceLine({
      price: level,
      color: level === 0 ? ct.muted : Math.abs(level) === 2 ? ct.down : ct.cyan,
      lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
      title: level === 0 ? "mean" : `${level > 0 ? "+" : ""}${level}σ`,
    })
  );
}

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

  const ct = useChartTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const base = baseChartOptions(ct);
    const chart = createChart(containerRef.current, {
      ...base,
      timeScale: { ...base.timeScale, timeVisible: false },
      autoSize: true,
    });
    const series = chart.addLineSeries({ color: ct.accent, lineWidth: 2, priceLineVisible: false });
    seriesRef.current = series;
    priceLinesRef.current = addBandLines(series, ct);
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; priceLinesRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-theme in place on the light/dark toggle.
  useEffect(() => {
    chartRef.current?.applyOptions(baseChartOptions(ct));
    const series = seriesRef.current;
    if (!series) return;
    series.applyOptions({ color: ct.accent });
    priceLinesRef.current.forEach((l) => series.removePriceLine(l));
    priceLinesRef.current = addBandLines(series, ct);
  }, [ct]);

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
