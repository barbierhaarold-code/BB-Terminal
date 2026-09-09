// ────────────────────────────────────────────────────────────
// AI Copilot tools — each one wraps the exact functions/stores that already
// power the corresponding module's UI. No data fetching or stat computation
// is reimplemented here; this file is orchestration only. Every tool must
// return either real data or an explicit `available: false` / `error`
// field — never a fabricated number (see SYSTEM_PROMPT in copilotConfig.ts).
// ────────────────────────────────────────────────────────────
import {
  fetchSpotQuote, fetchGoldCot, fetchIntraday, SPOT_GOLD_SYMBOL,
  fetchQuotes, fetchProfile, fetchHistorical, fetchEconCalendar,
  fetchForexNews, fetchGeneralNews,
  type Quote, type Profile, type Candle,
} from "@/lib/api";
import { SESSIONS, sessionStatus, overlaps, DXY, intradayStats } from "@/lib/forex";
import { computeStats } from "@/lib/journal";
import { useJournal } from "@/store/journalStore";
import {
  computePositionMetrics, computeBookTotals, sectorAllocation,
  buildEquityCurve, indexToCostBasis, riskStats, type SeriesPoint,
} from "@/lib/portfolio";
import { usePortfolio } from "@/store/portfolioStore";
import { estimateImpact } from "@/lib/econCalendar";
import { weekRange, addWeeks } from "@/lib/weekview";
import type { AnthropicTool } from "@/lib/copilotClient";

export const COPILOT_TOOLS: AnthropicTool[] = [
  {
    name: "get_scalper_snapshot",
    description: "Current spot XAU/USD (gold) price, which forex sessions (Sydney/Tokyo/London/New York) are open right now and whether we're in a major overlap, latest CFTC COT positioning for gold, and a quick USD-strength (DXY) read. Use this for any question about current gold price, trading session timing, or gold positioning.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_track_record_stats",
    description: "Current Track Record (trading journal) performance stats — win rate, profit factor, Sharpe, Calmar, drawdown, expectancy, avg win/loss, trades/week, by-direction and by-weekday breakdowns — plus the N most recent logged trades with their journal notes (setup, macro bias, conviction, news, feeling). Real underlying figures regardless of the UI's privacy toggle (this is Harold's own private copilot). Use for any question about trading performance/history.",
    input_schema: {
      type: "object",
      properties: {
        recentTradesLimit: { type: "integer", description: "How many of the most recent trades to include (default 10, max 50)." },
      },
    },
  },
  {
    name: "get_news_headlines",
    description: "Recent market/forex news headlines and upcoming economic calendar events (with an estimated impact rating). Use for any question about recent news or what's on the economic calendar.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max headlines to return (default 15, max 40)." },
      },
    },
  },
  {
    name: "get_portfolio_snapshot",
    description: "Current open positions, per-name and sector allocation, book totals (market value, day/total P&L), performance vs the S&P 500 (SPY) since the earliest position, and risk stats (Sharpe, annualized volatility, max drawdown, win rate). Use for any question about portfolio holdings or performance.",
    input_schema: { type: "object", properties: {} },
  },
];

// ────────────────────────────────────────────────────────────
// get_scalper_snapshot
// ────────────────────────────────────────────────────────────
async function toolScalperSnapshot() {
  const [spot, cot, dxyCandles] = await Promise.all([
    fetchSpotQuote(SPOT_GOLD_SYMBOL).catch((e: Error) => ({ available: false as const, reason: e.message })),
    fetchGoldCot().catch((e: Error) => ({ available: false as const, reason: e.message })),
    fetchIntraday(DXY.symbol, { kind: "metal" }).catch(() => undefined as Candle[] | undefined),
  ]);

  const now = new Date();
  const sessions = SESSIONS.map((def) => {
    const s = sessionStatus(def, now);
    return { name: s.def.name, open: s.open, localTime: s.localTime, weekend: s.weekend };
  });

  const dxy = dxyCandles ? intradayStats(dxyCandles) : undefined;
  const dxyRegime = dxy?.last != null && dxy.prevClose != null
    ? { last: dxy.last, changePct: ((dxy.last - dxy.prevClose) / dxy.prevClose) * 100, asOf: dxy.asOf }
    : { available: false as const, reason: "DXY intraday data unavailable." };

  return {
    spotXauUsd: spot,
    sessions,
    overlaps: overlaps(now),
    cotGold: cot,
    dxyRegime,
    asOf: now.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────
// get_track_record_stats
// ────────────────────────────────────────────────────────────
function toolTrackRecordStats(input: { recentTradesLimit?: number }) {
  const { trades, setups, baseCapital } = useJournal.getState();
  if (trades.length === 0) {
    return { available: false, reason: "No trades logged yet in Track Record." };
  }
  const limit = Math.min(Math.max(input.recentTradesLimit ?? 10, 1), 50);
  const setupName = (id?: string) => setups.find((s) => s.id === id)?.name;
  const stats = computeStats(trades, baseCapital);
  const recentTrades = [...trades]
    .sort((a, b) => (a.entryAt < b.entryAt ? 1 : -1))
    .slice(0, limit)
    .map((t) => ({
      symbol: t.symbol, direction: t.direction, size: t.size,
      entryPrice: t.entryPrice, exitPrice: t.exitPrice, result: t.result,
      entryAt: t.entryAt, exitAt: t.exitAt,
      setup: setupName(t.setupId), macroBias: t.macroBias, conviction: t.conviction,
      newsEvent: t.newsEvent, feeling: t.feeling, notes: t.notes,
    }));

  return {
    stats: {
      count: stats.count, winRate: stats.winRate, profitFactor: stats.profitFactor,
      sharpe: stats.sharpe, calmar: stats.calmar, expectancy: stats.expectancy,
      netProfit: stats.netProfit, avgWin: stats.avgWin, avgLoss: stats.avgLoss,
      maxDrawdownPct: stats.maxDrawdownPct, currentDrawdownPct: stats.currentDrawdownPct,
      tradesPerWeek: stats.tradesPerWeek, avgDurationMs: stats.avgDurationMs,
      byDirection: stats.byDirection, byWeekday: stats.byWeekday,
    },
    recentTrades,
  };
}

// ────────────────────────────────────────────────────────────
// get_news_headlines
// ────────────────────────────────────────────────────────────
async function toolNewsHeadlines(input: { limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 15, 1), 40);

  const [forexNews, generalNews] = await Promise.all([
    fetchForexNews(limit).catch(() => []),
    fetchGeneralNews(Math.ceil(limit / 2)).catch(() => []),
  ]);
  const seen = new Set<string>();
  const headlines = [...forexNews, ...generalNews]
    .filter((n) => {
      const key = (n.url || n.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .slice(0, limit)
    .map((n) => ({ title: n.title, date: n.date, source: n.source, url: n.url }));

  const now = new Date();
  const thisWeek = weekRange(now);
  let events = await fetchEconCalendar(thisWeek.monday, thisWeek.friday).catch(() => []);
  let upcoming = events.filter((e) => new Date(e.date) >= now);
  if (upcoming.length < 5) {
    const nextWeek = weekRange(addWeeks(now, 1));
    const more = await fetchEconCalendar(nextWeek.monday, nextWeek.friday).catch(() => []);
    upcoming = [...upcoming, ...more];
  }
  const upcomingEvents = upcoming
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 15)
    .map((e) => ({
      date: e.date, country: e.country, event: e.event,
      consensus: e.consensus, previous: e.previous,
      impact: estimateImpact(e),
    }));

  return { headlines, upcomingEvents };
}

// ────────────────────────────────────────────────────────────
// get_portfolio_snapshot
// ────────────────────────────────────────────────────────────
function rebase(series: SeriesPoint[], fromDate: string): SeriesPoint[] {
  const start = series.find((s) => s.date >= fromDate) ?? series[0];
  if (!start || !start.value) return series.map((s) => ({ date: s.date, value: 100 }));
  return series.map((s) => ({ date: s.date, value: (s.value / start.value) * 100 }));
}

async function toolPortfolioSnapshot() {
  const { positions } = usePortfolio.getState();
  if (positions.length === 0) {
    return { available: false, reason: "No positions tracked yet in Portfolio Tracker." };
  }
  const symbols = positions.map((p) => p.symbol);

  const [quotes, profiles] = await Promise.all([
    fetchQuotes(symbols).catch(() => [] as Quote[]),
    Promise.all(symbols.map((s) => fetchProfile(s).catch(() => undefined as Profile | undefined))),
  ]);
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  const sectorBySymbol = new Map(symbols.map((s, i) => [s, profiles[i]?.sector]));

  const rows = computePositionMetrics(positions, quoteBySymbol);
  const totals = computeBookTotals(rows);
  const sectors = sectorAllocation(rows, sectorBySymbol);

  const earliestDate = positions.reduce((min, p) => (p.date < min ? p.date : min), positions[0].date);
  let performanceVsSpx: Record<string, unknown> = { available: false, reason: "Not enough price history to compute yet." };
  let risk: unknown = {};
  try {
    const [histBySymbol, benchHist] = await Promise.all([
      Promise.all(symbols.map((s) => fetchHistorical(s, { interval: "1d", start_date: earliestDate }).catch(() => [] as Candle[]))),
      fetchHistorical("SPY", { interval: "1d", start_date: earliestDate }).catch(() => [] as Candle[]),
    ]);
    const historyBySymbol = new Map(symbols.map((s, i) => [s, histBySymbol[i]]));
    const portfolioSeries = indexToCostBasis(buildEquityCurve(positions, historyBySymbol), positions);
    const rawBench = benchHist.map((c) => ({ date: c.date.slice(0, 10), value: c.close }));
    const benchSeries = portfolioSeries.length > 0 ? rebase(rawBench, portfolioSeries[0].date) : [];
    if (portfolioSeries.length > 0 && benchSeries.length > 0) {
      performanceVsSpx = {
        portfolioIndexed: portfolioSeries[portfolioSeries.length - 1].value,
        spxIndexed: benchSeries[benchSeries.length - 1].value,
        sinceDate: portfolioSeries[0].date,
      };
    }
    risk = riskStats(portfolioSeries, positions);
  } catch (e) {
    performanceVsSpx = { available: false, reason: (e as Error).message };
  }

  return {
    positions: rows.map((r) => ({
      symbol: r.position.symbol, shares: r.position.shares, last: r.last,
      dayPnlPct: r.dayPnlPct, totalPnlPct: r.totalPnlPct, weightPct: r.weight,
    })),
    totals,
    sectorAllocation: sectors,
    performanceVsSpx,
    riskStats: risk,
  };
}

// ────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────
export async function runCopilotTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_scalper_snapshot": return toolScalperSnapshot();
    case "get_track_record_stats": return toolTrackRecordStats(input);
    case "get_news_headlines": return toolNewsHeadlines(input);
    case "get_portfolio_snapshot": return toolPortfolioSnapshot();
    default: throw new Error(`Unknown tool "${name}"`);
  }
}
