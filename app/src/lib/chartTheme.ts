import { ColorType } from "lightweight-charts";
import { useThemeMode, type ThemeMode } from "@/store/themeStore";

/**
 * Explicit colour values for charting libraries that take literal colours
 * instead of inheriting CSS (TradingView lightweight-charts, hand-rolled SVG
 * charts, the d3 heatmap). Keep these in step with the CSS variables in
 * `app/src/index.css`.
 *
 * `accent` / `accentSoft` (violet) are byte-identical across both modes — the
 * locked branding. Everything else tracks the light/dark surface + text stack.
 */
export interface ChartPalette {
  /** axis + legend label text */
  text: string;
  /** price-scale / time-scale border */
  border: string;
  /** chart grid lines (already alpha-baked) */
  grid: string;
  /** violet accent — crosshair, primary line series, spot markers. LOCKED. */
  accent: string;
  /** faint violet fill/marker — LOCKED */
  accentSoft: string;
  /** bright violet — LOCKED (SMA overlay, secondary accents) */
  accentBright: string;
  /** P&L up */
  up: string;
  /** P&L down */
  down: string;
  /** translucent up (volume bars) */
  upFill: string;
  /** translucent down (volume bars) */
  downFill: string;
  /** cyan data series */
  cyan: string;
  /** 4th categorical series colour (amber-gold, not the locked violet) */
  series4: string;
  /** muted text / minor labels */
  muted: string;
  /** thin SVG axis rule (maps to --term-border-soft) */
  axisLine: string;
  /** hairline separating tiles from the page (maps to --term-bg) */
  pageStroke: string;
  /** dashed reference line that isn't the accent (spot marker in IV skew) */
  refLine: string;
  /** neutral secondary line series (benchmark) */
  neutral: string;
  /** treemap "no data" cell */
  heatEmpty: string;
  /** faint centered chart watermark text */
  watermark: string;
}

const DARK: ChartPalette = {
  text: "#8a8a8a",
  border: "#2a2a2a",
  grid: "rgba(42,42,42,0.4)",
  accent: "#b45cff",
  accentSoft: "rgba(180,92,255,0.5)",
  accentBright: "#cd93ff",
  up: "#22ee22",
  down: "#ff3b3b",
  upFill: "rgba(34,238,34,0.5)",
  downFill: "rgba(255,59,59,0.5)",
  cyan: "#22ccee",
  series4: "#ffb020",
  muted: "#6e6e6e",
  axisLine: "#1f1f1f",
  pageStroke: "#0a0a0a",
  refLine: "#3a3a3a",
  neutral: "#8a8a8a",
  heatEmpty: "rgba(40,40,40,0.9)",
  watermark: "rgba(208,208,208,0.06)",
};

const LIGHT: ChartPalette = {
  text: "#71717a",
  border: "#cdcdd4",
  grid: "rgba(120,120,130,0.18)",
  accent: "#b45cff",
  accentSoft: "rgba(180,92,255,0.5)",
  accentBright: "#cd93ff",
  up: "#0d802b",
  down: "#c81e1e",
  upFill: "rgba(13,128,43,0.45)",
  downFill: "rgba(200,30,30,0.4)",
  cyan: "#0e7490",
  series4: "#a06a00",
  muted: "#71717a",
  axisLine: "#e0e0e6",
  pageStroke: "#f4f4f6",
  refLine: "#b8b8c0",
  neutral: "#9a9aa3",
  heatEmpty: "rgba(210,210,216,0.9)",
  watermark: "rgba(20,20,30,0.05)",
};

export const CHART_THEME: Record<ThemeMode, ChartPalette> = { dark: DARK, light: LIGHT };

/**
 * Current chart palette. Returns a stable module-level object per mode, so it's
 * safe to use directly in a `useEffect` dependency array — the effect re-runs
 * only when the theme actually flips.
 */
export function useChartTheme(): ChartPalette {
  return CHART_THEME[useThemeMode()];
}

/**
 * Shared lightweight-charts options block (layout / scales / grid). Spread this
 * into `createChart(...)` at build time AND into `chart.applyOptions(...)` from
 * an effect keyed on the palette so the chart re-themes without a full rebuild.
 * Crosshair is left to each caller (some charts don't want one).
 */
export function baseChartOptions(p: ChartPalette) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: p.text,
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 11,
    },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border },
    grid: {
      vertLines: { color: p.grid },
      horzLines: { color: p.grid },
    },
  };
}

/** Violet dashed crosshair — same in both themes (locked accent). */
export function crosshairOptions(p: ChartPalette) {
  return {
    vertLine: { color: p.accent, labelBackgroundColor: p.accent },
    horzLine: { color: p.accent, labelBackgroundColor: p.accent },
  };
}
