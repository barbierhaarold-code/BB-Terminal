import type { Candle } from "@/lib/api";

// ────────────────────────────────────────────────────────────
// Classic chart (GP) — timeframe/resample/SMA/legend math. Kept out of
// GP.tsx so the component file stays about wiring lightweight-charts up,
// not about the numbers.
// ────────────────────────────────────────────────────────────

export interface Timeframe {
  label: string;
  /** Interval actually requested from the API — always one yfinance/OpenBB
   * natively supports (verified live: 1m,2m,5m,15m,30m,60m,1h,1d,5d,1W,1M,1Q
   * — no native 3m/4h). */
  fetchInterval: string;
  /** How many lookback days to request at `fetchInterval`. */
  days: number;
  /** Consecutive base candles folded into one bar; 1 = no resampling. */
  resample: number;
}

// 3m and 4H aren't native yfinance intervals — built by resampling the
// nearest native interval (1m×3, 60m×4) client-side instead of silently
// substituting a different timeframe the user didn't ask for.
export const TIMEFRAMES: Timeframe[] = [
  { label: "1m",  fetchInterval: "1m",  days: 5,   resample: 1 },
  { label: "3m",  fetchInterval: "1m",  days: 5,   resample: 3 },
  { label: "5m",  fetchInterval: "5m",  days: 30,  resample: 1 },
  { label: "15m", fetchInterval: "15m", days: 55,  resample: 1 },
  { label: "30m", fetchInterval: "30m", days: 55,  resample: 1 },
  { label: "1H",  fetchInterval: "60m", days: 180, resample: 1 },
  { label: "4H",  fetchInterval: "60m", days: 180, resample: 4 },
  { label: "1D",  fetchInterval: "1d",  days: 730, resample: 1 },
];

/** Fold every `factor` consecutive (chronological) candles into one OHLCV bar. */
export function resampleCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    out.push({
      date: chunk[0].date,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume ?? 0), 0),
    });
  }
  return out;
}

/** Simple moving average of closes, aligned 1:1 with `candles` (undefined
 * wherever fewer than `period` closes have accumulated yet). */
export function sma(candles: Candle[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export interface LegendStats {
  last?: number;
  high?: number;
  low?: number;
  average?: number;
}

/** Last/high/average/low over whatever slice of candles is passed in — the
 * caller decides "visible range" vs "whole series". */
export function legendStats(candles: Candle[]): LegendStats {
  if (candles.length === 0) return {};
  let high = -Infinity, low = Infinity, sum = 0;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    sum += c.close;
  }
  return {
    last: candles[candles.length - 1].close,
    high,
    low,
    average: sum / candles.length,
  };
}
