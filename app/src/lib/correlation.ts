import type { Candle } from "@/lib/api";

// ────────────────────────────────────────────────────────────
// Shared correlation utility — used today by the FXC correlation panel
// (XAU/USD × DXY, XAU/USD × BTC), and meant to be the same function the
// later Analytics/Quant correlation matrix reuses, not a page-specific
// throwaway. Keep this module free of any FXC/UI-specific assumptions.
// ────────────────────────────────────────────────────────────

/** Period-over-period % change series from closes, chronological order. */
export function pctReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev) out.push((closes[i] - prev) / prev);
  }
  return out;
}

/** Pearson correlation coefficient of two equal-length, index-aligned series. */
export function correlation(a: number[], b: number[]): number | undefined {
  const n = Math.min(a.length, b.length);
  if (n < 2) return undefined;
  const xs = a.slice(-n), ys = b.slice(-n);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  const denom = Math.sqrt(vx * vy);
  return denom === 0 ? undefined : cov / denom;
}

/**
 * Inner-join two daily candle series by calendar date. Needed because gold/
 * DXY (5-day trading week, exchange holidays) and crypto (7-day, no holidays)
 * don't share a trading calendar — correlating by raw array index would
 * silently pair the wrong days' returns together.
 */
function alignByDate(a: Candle[], b: Candle[]): [number[], number[]] {
  const bByDate = new Map(b.map((c) => [c.date.slice(0, 10), c.close]));
  const ac: number[] = [], bc: number[] = [];
  for (const c of a) {
    const bClose = bByDate.get(c.date.slice(0, 10));
    if (bClose != null) { ac.push(c.close); bc.push(bClose); }
  }
  return [ac, bc];
}

/**
 * Rolling N-period correlation of daily returns between two date-aligned
 * daily candle series. Falls back to whatever history is available when
 * there's less than a full window (still 2+ points), rather than refusing
 * to render a number until exactly `window` days have accumulated.
 */
export function rollingCorrelation(a: Candle[], b: Candle[], window = 20): number | undefined {
  const [ac, bc] = alignByDate(a, b);
  const ra = pctReturns(ac), rb = pctReturns(bc);
  const n = Math.min(ra.length, rb.length);
  if (n < window) return correlation(ra, rb);
  return correlation(ra.slice(-window), rb.slice(-window));
}

// ────────────────────────────────────────────────────────────
// Labeled signal read — turns a raw coefficient + today's two % moves into
// a plain-language call, for grids like the Gold Intelligence correlation
// panel where "the coefficient is 0.34" isn't itself the point; whether
// today's move fits or breaks the recent relationship is.
// ────────────────────────────────────────────────────────────
export type CorrelationTone = "confirm" | "diverge" | "decorrelated" | "neutral";
export interface CorrelationSignal {
  label: string;
  tone: CorrelationTone;
}

/** Below this |r|, the rolling relationship itself is too weak to call a direction on. */
const WEAK_CORR = 0.2;
/** Below this % move, a day's change is noise, not a real print to reason about. */
const MIN_MOVE_PCT = 0.15;

/**
 * Classify today's co-movement against the rolling correlation:
 * - |corr| below threshold → the pair isn't behaving with any structure
 *   right now, regardless of today ("Decorrelated — watch").
 * - either leg's move is too small to read → no real signal today.
 * - otherwise, today's direction either matches what the sign of `corr`
 *   would predict ("Confirming") or breaks from it ("Divergence").
 */
export function correlationSignal(
  corr: number | undefined,
  pctA: number | undefined,
  pctB: number | undefined
): CorrelationSignal {
  if (corr == null) return { label: "Neutral — no signal", tone: "neutral" };
  if (Math.abs(corr) < WEAK_CORR) return { label: "Decorrelated — watch", tone: "decorrelated" };
  if (pctA == null || pctB == null || Math.abs(pctA) < MIN_MOVE_PCT || Math.abs(pctB) < MIN_MOVE_PCT) {
    return { label: "Neutral — no signal", tone: "neutral" };
  }
  const sameDirectionToday = Math.sign(pctA) === Math.sign(pctB);
  const expectedSameDirection = corr > 0;
  return sameDirectionToday === expectedSameDirection
    ? { label: "Confirming", tone: "confirm" }
    : { label: "Divergence", tone: "diverge" };
}
