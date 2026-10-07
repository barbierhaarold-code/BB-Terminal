import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, LineStyle, CrosshairMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { useQuery } from "@tanstack/react-query";
import { fetchHistorical, type Candle } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtPrice } from "@/lib/format";
import { useChartTheme, baseChartOptions, crosshairOptions, type ChartPalette } from "@/lib/chartTheme";
import { TIMEFRAMES, resampleCandles, sma, legendStats, type Timeframe, type LegendStats } from "./gp/chartMath";

type ChartType = "candle" | "line";
interface SmaToggles { 50: boolean; 100: boolean; 200: boolean; }
const smaColors = (ct: ChartPalette): Record<keyof SmaToggles, string> =>
  ({ 50: ct.cyan, 100: ct.accentBright, 200: ct.up });

export function GP({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<Timeframe>(TIMEFRAMES[7]); // 1D default
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [smaOn, setSmaOn] = useState<SmaToggles>({ 50: false, 100: false, 200: false });
  const [gridOn, setGridOn] = useState(true);
  const [watermarkOn, setWatermarkOn] = useState(true);
  const ct = useChartTheme();

  const startDate = useMemo(
    () => new Date(Date.now() - tf.days * 864e5).toISOString().slice(0, 10),
    [tf.days]
  );
  const { data: raw, isLoading, isError } = useQuery({
    queryKey: ["gp-classic", symbol, tf.fetchInterval, tf.days],
    queryFn: () => fetchHistorical(symbol, { interval: tf.fetchInterval, start_date: startDate }),
    staleTime: tf.fetchInterval === "1d" ? 180_000 : 15_000,
    refetchInterval: tf.fetchInterval === "1d" ? undefined : 30_000,
  });

  const candles = useMemo(() => {
    const sorted = [...(raw ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    return resampleCandles(sorted, tf.resample);
  }, [raw, tf.resample]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const smaSeriesRef = useRef<Record<keyof SmaToggles, ISeriesApi<"Line"> | null>>({ 50: null, 100: null, 200: null });
  const [visibleStats, setVisibleStats] = useState<LegendStats>({});

  // Build the chart shell once.
  useEffect(() => {
    if (!containerRef.current) return;
    const base = baseChartOptions(ct);
    const chart = createChart(containerRef.current, {
      ...base,
      timeScale: { ...base.timeScale, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { ...crosshairOptions(ct).vertLine, width: 1, style: LineStyle.Dashed },
        horzLine: { ...crosshairOptions(ct).horzLine, width: 1, style: LineStyle.Dashed },
      },
      autoSize: true,
    });
    volumeSeriesRef.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null; mainSeriesRef.current = null; volumeSeriesRef.current = null;
      smaSeriesRef.current = { 50: null, 100: null, 200: null };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-theme the chart shell in place when the light/dark toggle flips.
  useEffect(() => {
    chartRef.current?.applyOptions({
      ...baseChartOptions(ct),
      crosshair: {
        vertLine: crosshairOptions(ct).vertLine,
        horzLine: crosshairOptions(ct).horzLine,
      },
    });
  }, [ct]);

  // Rebuild the main series when the chart type — or the theme — changes
  // (candlestick <-> line need different series types; lightweight-charts has
  // no "convert" call, and this is also the cleanest place to restyle it).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainSeriesRef.current) chart.removeSeries(mainSeriesRef.current);
    mainSeriesRef.current = chartType === "candle"
      ? chart.addCandlestickSeries({
          upColor: ct.up, downColor: ct.down, borderVisible: false,
          wickUpColor: ct.up, wickDownColor: ct.down,
        })
      : chart.addLineSeries({ color: ct.accent, lineWidth: 2, priceLineVisible: false });
    if (candles.length) setSeriesData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, ct]);

  function setSeriesData() {
    const series = mainSeriesRef.current;
    if (!series) return;
    if (chartType === "candle") {
      (series as ISeriesApi<"Candlestick">).setData(candles.map((c) => ({
        time: toTime(c.date), open: c.open, high: c.high, low: c.low, close: c.close,
      })));
    } else {
      (series as ISeriesApi<"Line">).setData(candles.map((c) => ({ time: toTime(c.date), value: c.close })));
    }
  }

  // Push candle + volume data whenever either changes.
  useEffect(() => {
    setSeriesData();
    volumeSeriesRef.current?.setData(candles.map((c) => ({
      time: toTime(c.date), value: c.volume ?? 0,
      color: c.close >= c.open ? ct.upFill : ct.downFill,
    })));
    // Container width isn't always settled on the very first paint (tab
    // restored from a persisted workspace, autoSize's ResizeObserver hasn't
    // fired yet) — fitContent() against a too-narrow width then leaves the
    // view zoomed into just the last few bars. One rAF later, layout has
    // caught up, so fit again to correct it without a visible flash.
    chartRef.current?.timeScale().fitContent();
    const raf = requestAnimationFrame(() => chartRef.current?.timeScale().fitContent());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, chartType, ct]);

  // SMA overlays — add/remove series per toggle, refresh data with candles.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    (Object.keys(smaOn) as unknown as (keyof SmaToggles)[]).forEach((period) => {
      const on = smaOn[period];
      let series = smaSeriesRef.current[period];
      if (on && !series) {
        series = chart.addLineSeries({
          color: smaColors(ct)[period], lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
          title: `SMA${period}`,
        });
        smaSeriesRef.current[period] = series;
      } else if (!on && series) {
        chart.removeSeries(series);
        smaSeriesRef.current[period] = null;
      } else if (on && series) {
        series.applyOptions({ color: smaColors(ct)[period] });
      }
      if (on && series) {
        const values = sma(candles, Number(period));
        series.setData(
          candles
            .map((c, i) => ({ time: toTime(c.date), value: values[i] }))
            .filter((p): p is { time: UTCTimestamp; value: number } => p.value != null)
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smaOn, candles, ct]);

  // Grid + watermark toggles.
  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: {
        vertLines: { visible: gridOn, color: ct.grid },
        horzLines: { visible: gridOn, color: ct.grid },
      },
    });
  }, [gridOn, ct]);
  useEffect(() => {
    chartRef.current?.applyOptions({
      watermark: {
        visible: watermarkOn, text: symbol, color: ct.watermark,
        fontSize: 64, horzAlign: "center", vertAlign: "center",
      },
    });
  }, [watermarkOn, symbol, ct]);

  // Legend box — recompute over whatever's actually on screen, not the
  // whole fetched series, so it tracks pan/zoom like the QFI reference.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) { setVisibleStats(legendStats(candles)); return; }
    const recompute = () => {
      const range = chart.timeScale().getVisibleRange();
      if (!range) { setVisibleStats(legendStats(candles)); return; }
      const from = range.from as number, to = range.to as number;
      const slice = candles.filter((c) => {
        const t = toTime(c.date);
        return t >= from && t <= to;
      });
      setVisibleStats(legendStats(slice.length ? slice : candles));
    };
    recompute();
    chart.timeScale().subscribeVisibleTimeRangeChange(recompute);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(recompute);
  }, [candles]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-2 h-7 border-b border-term-border bg-term-panel2 gap-3 flex-wrap text-[10px] uppercase tracking-wider">
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button key={t.label} onClick={() => setTf(t)}
              className={cn("px-1.5 py-0.5 border",
                t.label === tf.label ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {(["candle", "line"] as ChartType[]).map((ct) => (
              <button key={ct} onClick={() => setChartType(ct)}
                className={cn("px-1.5 py-0.5 border capitalize",
                  ct === chartType ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
                {ct}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {([50, 100, 200] as const).map((p) => (
              <button key={p} onClick={() => setSmaOn((s) => ({ ...s, [p]: !s[p] }))}
                style={smaOn[p] ? { borderColor: smaColors(ct)[p], color: smaColors(ct)[p] } : undefined}
                className={cn("px-1.5 py-0.5 border", !smaOn[p] && "border-transparent text-term-muted hover:text-term-text")}>
                SMA{p}
              </button>
            ))}
          </div>
          <button onClick={() => setGridOn((v) => !v)}
            className={cn("px-1.5 py-0.5 border", gridOn ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            Grid
          </button>
          <button onClick={() => setWatermarkOn((v) => !v)}
            className={cn("px-1.5 py-0.5 border", watermarkOn ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            Watermark
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        <LegendBox stats={visibleStats} />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-muted pointer-events-none">
            LOADING CHART…
          </div>
        )}
        {isError && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-red pointer-events-none">
            Failed to load price history.
          </div>
        )}
        {!isLoading && !isError && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest text-term-muted pointer-events-none">
            No data for this timeframe.
          </div>
        )}
      </div>
    </div>
  );
}

function toTime(dateIso: string): UTCTimestamp {
  return Math.floor(new Date(dateIso).getTime() / 1000) as UTCTimestamp;
}

function LegendBox({ stats }: { stats: LegendStats }) {
  if (stats.last == null) return null;
  return (
    <div className="absolute top-2 left-2 flex flex-col gap-0.5 text-[10px] bg-term-panel/80 border border-term-border px-2 py-1.5 pointer-events-none backdrop-blur-sm">
      <Row label="Last" value={stats.last} />
      <Row label="High" value={stats.high} />
      <Row label="Avg" value={stats.average} />
      <Row label="Low" value={stats.low} />
    </div>
  );
}

function Row({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center gap-3 justify-between">
      <span className="text-term-muted uppercase tracking-wider">{label}</span>
      <span className="num text-term-text">{value != null ? fmtPrice(value) : "—"}</span>
    </div>
  );
}
