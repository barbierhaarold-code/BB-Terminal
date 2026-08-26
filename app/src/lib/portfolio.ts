import type { Candle, Quote } from "@/lib/api";

export interface Position {
  id: string;
  symbol: string;
  shares: number;
  costBasis: number; // price per share paid, in USD
  date: string; // ISO date the position was opened
}
export type NewPosition = Omit<Position, "id">;

export interface PositionMetrics {
  position: Position;
  last?: number;
  prevClose?: number;
  marketValue?: number;
  costValue: number;
  dayPnl?: number;
  dayPnlPct?: number;
  totalPnl?: number;
  totalPnlPct?: number;
  weight?: number; // % of total book market value
}

/** Per-position P&L/value from live quotes, plus each row's weight in the book. */
export function computePositionMetrics(
  positions: Position[],
  quoteBySymbol: Map<string, Quote>
): PositionMetrics[] {
  const rows: PositionMetrics[] = positions.map((p) => {
    const q = quoteBySymbol.get(p.symbol);
    const last = q?.last_price;
    const prevClose = q?.prev_close;
    const costValue = p.costBasis * p.shares;
    const marketValue = last != null ? last * p.shares : undefined;
    const dayPnl = last != null && prevClose != null ? (last - prevClose) * p.shares : undefined;
    const dayPnlPct = last != null && prevClose ? ((last - prevClose) / prevClose) * 100 : undefined;
    const totalPnl = last != null ? (last - p.costBasis) * p.shares : undefined;
    const totalPnlPct = p.costBasis ? ((last! - p.costBasis) / p.costBasis) * 100 : undefined;
    return { position: p, last, prevClose, marketValue, costValue, dayPnl, dayPnlPct, totalPnl, totalPnlPct };
  });
  const totalValue = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
  return rows.map((r) => ({
    ...r,
    weight: totalValue > 0 && r.marketValue != null ? (r.marketValue / totalValue) * 100 : undefined,
  }));
}

export interface BookTotals {
  marketValue: number;
  costValue: number;
  dayPnl: number;
  totalPnl: number;
  dayPnlPct?: number;
  totalPnlPct?: number;
}

export function computeBookTotals(rows: PositionMetrics[]): BookTotals {
  let marketValue = 0, costValue = 0, dayPnl = 0, totalPnl = 0, prevValue = 0;
  for (const r of rows) {
    marketValue += r.marketValue ?? 0;
    costValue += r.costValue;
    dayPnl += r.dayPnl ?? 0;
    totalPnl += r.totalPnl ?? 0;
    if (r.prevClose != null) prevValue += r.prevClose * r.position.shares;
  }
  return {
    marketValue, costValue, dayPnl, totalPnl,
    dayPnlPct: prevValue > 0 ? (dayPnl / prevValue) * 100 : undefined,
    totalPnlPct: costValue > 0 ? (totalPnl / costValue) * 100 : undefined,
  };
}

export interface SectorSlice { sector: string; value: number; weight: number; }

/** Group live position value by sector (looked up per-symbol from company profiles). */
export function sectorAllocation(
  rows: PositionMetrics[],
  sectorBySymbol: Map<string, string | undefined>
): SectorSlice[] {
  const totals = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const v = r.marketValue ?? 0;
    if (v <= 0) continue;
    const sector = sectorBySymbol.get(r.position.symbol) || "Unclassified";
    totals.set(sector, (totals.get(sector) ?? 0) + v);
    total += v;
  }
  return Array.from(totals.entries())
    .map(([sector, value]) => ({ sector, value, weight: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

export interface SeriesPoint { date: string; value: number; }

/**
 * Daily book market-value series, summed across positions by calendar date.
 * A position only contributes from its own entry date forward, so adding a
 * name later doesn't retroactively inflate the book's earlier history.
 */
export function buildEquityCurve(positions: Position[], historyBySymbol: Map<string, Candle[]>): SeriesPoint[] {
  const byDate = new Map<string, number>();
  for (const p of positions) {
    const candles = historyBySymbol.get(p.symbol) ?? [];
    const openDate = p.date.slice(0, 10);
    for (const c of candles) {
      const d = c.date.slice(0, 10);
      if (d < openDate) continue;
      byDate.set(d, (byDate.get(d) ?? 0) + c.close * p.shares);
    }
  }
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Index a value series to 100 = the book's cost basis *as of each date*
 * (only positions already opened by that date count), not 100 = the book's
 * value on day one. That matters once a book holds more than one position:
 * indexing to day-one value would read a later position's entire cost as
 * if it were market appreciation the moment it's added. Indexing to the
 * running cost basis instead means 100 always means "trading at break-even"
 * — exactly the reference line the Performance tab is meant to show.
 */
export function indexToCostBasis(series: SeriesPoint[], positions: Position[]): SeriesPoint[] {
  return series.map(({ date, value }) => {
    const cost = positions
      .filter((p) => p.date.slice(0, 10) <= date)
      .reduce((s, p) => s + p.costBasis * p.shares, 0);
    return { date, value: cost > 0 ? (value / cost) * 100 : 100 };
  });
}

export interface RiskStats {
  sharpe?: number;
  annualizedVolatility?: number; // %
  maxDrawdown?: number; // % (negative or zero)
  winRate?: number; // % of positive days
}

const TRADING_DAYS = 252;

/**
 * Sharpe/vol/max-drawdown/win-rate from a daily value series' day-over-day
 * returns. Days a new position first contributes to the book are excluded
 * from the return series before computing anything: the capital injection
 * itself isn't a market move, and left in, it reads as a single huge daily
 * "return" that badly distorts volatility, Sharpe, and drawdown. Drawdown
 * is computed by compounding that same cleaned return series (not the raw
 * $ curve), so all four stats are internally consistent with each other.
 */
export function riskStats(series: SeriesPoint[], positions: Position[], riskFreeAnnual = 0): RiskStats {
  if (series.length < 3) return {};
  const openDates = new Set(positions.map((p) => p.date.slice(0, 10)));
  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    if (prev > 0 && !openDates.has(series[i].date)) {
      returns.push((series[i].value - prev) / prev);
    }
  }
  if (returns.length < 2) return {};

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(variance);
  const annualizedVolatility = stdev * Math.sqrt(TRADING_DAYS) * 100;
  const dailyRf = riskFreeAnnual / TRADING_DAYS;
  const sharpe = stdev > 0 ? ((mean - dailyRf) / stdev) * Math.sqrt(TRADING_DAYS) : undefined;

  let idx = 1, peak = 1, maxDD = 0;
  for (const r of returns) {
    idx *= 1 + r;
    if (idx > peak) peak = idx;
    if (peak > 0) maxDD = Math.min(maxDD, (idx - peak) / peak);
  }

  const winRate = (returns.filter((r) => r > 0).length / returns.length) * 100;

  return { sharpe, annualizedVolatility, maxDrawdown: maxDD * 100, winRate };
}
