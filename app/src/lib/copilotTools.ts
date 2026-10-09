// ────────────────────────────────────────────────────────────
// AI Copilot tools — each one wraps the exact functions/stores that already
// power the corresponding module's UI. No data fetching or stat computation
// is reimplemented here; this file is orchestration only. Every tool must
// return either real data or an explicit `available: false` / `error`
// field — never a fabricated number (see SYSTEM_PROMPT in copilotConfig.ts).
// ────────────────────────────────────────────────────────────
import {
  fetchSpotQuote, fetchIntraday, SPOT_GOLD_SYMBOL,
  fetchQuotes, fetchProfile, fetchHistorical, fetchEconCalendar,
  fetchForexNews, fetchGeneralNews,
  type Quote, type Profile, type Candle,
} from "@/lib/api";
import { SESSIONS, sessionStatus, overlaps, DXY, intradayStats } from "@/lib/forex";
import { computeStats, MACRO_BIAS_OPTIONS, CONVICTION_OPTIONS, type Direction } from "@/lib/journal";
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { adherenceStats, computeRealizedR, entryReference, plannedRiskDollars, plannedRMultiples, R_NOTE, statusCounts } from "@/lib/tradePlan";
import { useWorkspace } from "@/store/workspaceStore";
import { useTradeDraft, type TradeDraft } from "@/store/tradeDraftStore";
import { FUNCTIONS } from "@/lib/functions";
import {
  computePositionMetrics, computeBookTotals, sectorAllocation,
  buildEquityCurve, indexToCostBasis, riskStats, type SeriesPoint,
} from "@/lib/portfolio";
import { usePortfolio } from "@/store/portfolioStore";
import { estimateImpact } from "@/lib/econCalendar";
import { toYmd } from "@/lib/weekview";
import type { AnthropicTool } from "@/lib/copilotClient";
import { getCotSnapshot, cotContract, cotContractSummary, cotSnapshotMeta, isKnownCotKey } from "@/lib/cot";
import { COT_CONTRACTS } from "@/lib/cotContracts";
import { getMacroSnapshot } from "@/lib/macro/client";
import { buildViews } from "@/lib/macro/math";
import { macroSummary } from "@/lib/macro/summary";
import { ECONOMIES } from "@/lib/macro/config";
import { getMarketLeanResults } from "@/lib/lean/data";
import { INSTRUMENTS, LEAN_THRESHOLD, WALK_FORWARD_MULT, BASE_WEIGHTS, DRIVER_AGREEMENT_NOTE, GOLD_SOURCE_NOTE } from "@/lib/lean/config";
import { historicalAgreement, driverHistoryNote } from "@/lib/lean/history";

export const COPILOT_TOOLS: AnthropicTool[] = [
  {
    name: "get_scalper_snapshot",
    description: "Current spot XAU/USD (gold) price, which forex sessions (Sydney/Tokyo/London/New York) are open right now and whether we're in a major overlap, latest official CFTC COT positioning for gold (weekly: positions as of Tuesday, published Friday; not live), and a quick USD-strength (DXY) read. Use this for any question about current gold price, trading session timing, or gold positioning.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_cot_positioning",
    description: "Official CFTC Commitments of Traders positioning (futures only), the same numbers as the COT page. Without arguments returns every tracked contract (EUR, GBP, JPY, AUD, CAD, CHF, NZD, US Dollar Index, Gold, Silver, WTI, E-mini S&P 500, E-mini Nasdaq-100, Bitcoin) with the headline trader group's net position, weekly change, open interest and 3-year / 5-year percentile. With `contract` returns that contract's full breakdown by trader group. COT is WEEKLY: positions are as of Tuesday and published the following Friday 3:30 pm ET, so never describe it as live; always state the 'positions as of' date. Percentiles say how extreme positioning is versus its own history, not a trade signal. If the result says a contract or the source is unavailable (or the fallback source is in use), relay that plainly.",
    input_schema: {
      type: "object",
      properties: {
        contract: {
          type: "string",
          enum: COT_CONTRACTS.map((c) => c.key),
          description: "Optional contract key: eur, gbp, jpy, aud, cad, chf, nzd, dxy, es, nq, btc, gold, silver, wti. Omit for the overview of all contracts.",
        },
      },
    },
  },
  {
    name: "get_macro_snapshot",
    description: "Macro Hub (page code MACRO), READ-ONLY: published macro statistics per economy from DBnomics, the same numbers as the page. For each economy: policy rate, CPI inflation YoY, core CPI, unemployment rate, real GDP growth and 10-year yield WHERE a licensed, fresh series exists, each with its latest value, the observation period (a month or quarter, NOT today), the previous value and change, the provider, the date DBnomics last refreshed it, its attribution, and a 'stale' flag (older than expected for its frequency). Inflation for Japan is computed from the published index and says so. 'realPolicyRate' is computed (policy rate minus CPI YoY, latest available of each) only when both inputs are fresh; relay its caveat about mixed frequencies and show both observation dates. 'coverageGaps' lists every cell that has no series and why: say so plainly instead of estimating. This is descriptive context, never a forecast, signal or advice; always state the observation period; never describe a monthly or quarterly figure as live or current. No write actions.",
    input_schema: {
      type: "object",
      properties: {
        economy: {
          type: "string",
          enum: ECONOMIES.map((e) => e.id),
          description: "Optional economy code: US, EA (Euro Area), UK, JP, CA, AU, NZ, CH. Omit for all eight.",
        },
      },
    },
  },
  {
    name: "get_market_lean",
    description: "Market Context (page code LEAN): a transparent, rule-based BACKDROP per instrument (XAUUSD, DXY, EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, SPX, NDX, WTI, BTC), the same numbers as the page. 'backdrop' is Supportive / Headwind / Neutral / No data for that instrument, derived only from the drivers that carry weight (today: Dollar & rates), with a composite score, every driver's raw inputs, scores and weights (trend, COT positioning, risk regime and cross-asset are shown but carry weight 0), what would change the backdrop, and data freshness. 'driverAgreement' is the share of weighted drivers pointing the same way, not a probability of being right, and is null (n/a) unless at least two drivers carry weight. The walk-forward test found no statistically significant edge in the combined backdrop, so NEVER present it as a forecast, prediction, probability, signal or buy/sell advice; always relay 'historicalAgreement' and 'driverAgreementNote' with it. Gold history is futures (GC=F), not spot. COT inside it is weekly (positions as of Tuesday), not live. Report any n/a input or warning plainly.",
    input_schema: {
      type: "object",
      properties: {
        instrument: { type: "string", enum: INSTRUMENTS.map((i) => i.id), description: "Optional instrument id. Omit for a one-line summary of all 13." },
      },
    },
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
    name: "get_trade_plans",
    description: "READ-ONLY view of the Trade Plan journal (page code PLAN): the user's documented pre-trade plans (each may have an optional title). Returns the open plans (status active or triggered) with symbol, direction, entry zone, stop, targets, planned risk % and dollars, conviction (the user's own rating) and any frozen context snapshot with its as-of dates; counts per status; and adherence stats (followed yes / partly / no) with the sample size n and, for plans linked to a trade, net result and mean realized R (realized R is n/a when the linked trade's numbers are not valid; never guess it). Plans are the user's intentions, not forecasts. Always relay the sample size and the small-sample note; draw no conclusion from small n. There is no write action.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_news_headlines",
    description: "Recent market/forex news headlines. Use for any question about recent news. For the economic calendar / upcoming data releases, use get_econ_calendar instead.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max headlines to return (default 15, max 40)." },
      },
    },
  },
  {
    name: "get_econ_calendar",
    description: "Upcoming economic calendar events (data releases, central-bank events, auctions) from now forward. Defaults to a 7-day window to match the Econ Calendar module's week view. Each event carries an ESTIMATED impact rating (high/medium/low) derived from a keyword + economy-size heuristic — Nasdaq's free calendar ships no licensed impact rating, so always relay it as an estimate, never as a definitive call. Use for any question about what's on the calendar or the next high-impact event.",
    input_schema: {
      type: "object",
      properties: {
        daysAhead: { type: "integer", description: "How many days forward to look from today (default 7, min 1, max 30)." },
      },
    },
  },
  {
    name: "get_portfolio_snapshot",
    description: "Current open positions, per-name and sector allocation, book totals (market value, day/total P&L), performance vs the S&P 500 (SPY) since the earliest position, and risk stats (Sharpe, annualized volatility, max drawdown, win rate). Use for any question about portfolio holdings or performance.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "navigate_to_function",
    description: "Open a terminal module by its function code — exactly like typing the code in the command bar. Pure UI navigation, changes no data. Use when Harold asks to go to / open / show a screen (e.g. 'open the scalper', 'take me to Track Record'). Common codes: CC (Command Center), FXC (Forex Center), TRACK (Track Record), NH (News Hub), CRYPTO, QUANT, PORTFOLIO, HEAT (heatmap), GP/KEY/FA/RESEARCH (need a symbol). An unknown code is returned as an error for you to relay honestly.",
    input_schema: {
      type: "object",
      properties: {
        functionCode: { type: "string", description: "The function code, e.g. \"FXC\" or \"TRACK\"." },
        symbol: { type: "string", description: "Ticker, only for symbol-scoped functions like GP/KEY/FA/RESEARCH (e.g. \"AAPL\")." },
      },
      required: ["functionCode"],
    },
  },
  {
    name: "prefill_track_record_entry",
    description: "Open Track Record and PRE-FILL (never submit) its manual 'Log a Trade' form with trade details Harold described in chat. Nothing is saved — Harold reviews the form and clicks Log Trade himself. Before calling this, tell him in plain language exactly what you're about to pre-fill (direction, symbol, entry, exit, size, tags). Only pass fields you parsed with confidence; omit anything uncertain (it stays blank). Symbol defaults to XAU/USD if he didn't name one.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["buy", "sell"], description: "buy = long / achat, sell = short / vente." },
        symbol: { type: "string", description: "Instrument, e.g. \"XAU/USD\" (default), \"EUR/USD\", \"AAPL\"." },
        entryPrice: { type: "number", description: "Entry price." },
        exitPrice: { type: "number", description: "Exit price." },
        size: { type: "number", description: "Position size in lots." },
        entryAt: { type: "string", description: "Entry date-time, ISO 8601 or \"YYYY-MM-DDTHH:mm\". Omit to leave the form's default (now)." },
        exitAt: { type: "string", description: "Exit date-time, same formats. Optional." },
        setup: { type: "string", description: "Setup / strategy tag (free text — created if it doesn't exist yet)." },
        macroBias: { type: "string", enum: MACRO_BIAS_OPTIONS, description: "Macro bias of the day, if stated." },
        conviction: { type: "string", enum: CONVICTION_OPTIONS, description: "Conviction level, if stated." },
        newsEvent: { type: "string", description: "Linked news / macro event, if mentioned." },
        feeling: { type: "string", description: "How the trade felt (confiant, FOMO, revenge trade, patient…), if mentioned." },
        notes: { type: "string", description: "Free-text execution / management notes, if mentioned." },
      },
    },
  },
];

// ────────────────────────────────────────────────────────────
// get_scalper_snapshot
// ────────────────────────────────────────────────────────────
async function toolScalperSnapshot() {
  const [spot, cot, dxyCandles] = await Promise.all([
    fetchSpotQuote(SPOT_GOLD_SYMBOL).catch((e: Error) => ({ available: false as const, reason: e.message })),
    toolCotGold(),
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
// get_cot_positioning (+ the gold COT slice of get_scalper_snapshot)
// Both read the SAME cached snapshot as the COT page / Gold Intelligence / Quant
// (lib/cot.ts), so the Copilot can never quote different numbers than the UI.
// ────────────────────────────────────────────────────────────
async function toolCotGold() {
  try {
    const snap = await getCotSnapshot();
    const gold = cotContract(snap, "gold");
    if (!gold) return { available: false as const, reason: "Gold is missing from the COT snapshot." };
    return { ...cotContractSummary(snap, gold), meta: cotSnapshotMeta(snap) };
  } catch (e) {
    return { available: false as const, reason: (e as Error).message };
  }
}

async function toolCotPositioning(input: { contract?: string }) {
  let snap;
  try { snap = await getCotSnapshot(); }
  catch (e) { return { available: false, reason: (e as Error).message }; }

  const meta = cotSnapshotMeta(snap);
  if (input.contract) {
    const key = input.contract.toLowerCase();
    if (!isKnownCotKey(key)) return { available: false, reason: `Unknown contract "${input.contract}". Valid keys: ${COT_CONTRACTS.map((c) => c.key).join(", ")}.` };
    const c = cotContract(snap, key);
    if (!c) return { available: false, reason: `Contract "${key}" is missing from the COT snapshot.` };
    return { ...cotContractSummary(snap, c), meta };
  }
  return {
    meta,
    contracts: snap.contracts.map((c) => {
      const s = cotContractSummary(snap, c);
      if (!s.available) return s;
      const head = s.categories.find((r) => r.category === s.headlineCategory);
      return {
        contract: s.contract, key: s.key, positionsAsOf: s.positionsAsOf, headlineCategory: s.headlineCategory,
        net: head?.net, netWeeklyChange: head?.netWeeklyChange, percentile3y: head?.percentile3y, percentile5y: head?.percentile5y,
        openInterest: s.openInterest,
      };
    }),
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
// get_trade_plans  (read-only)
// ────────────────────────────────────────────────────────────
function toolTradePlans() {
  const { plans, loadError } = useTradePlans.getState();
  if (loadError) return { available: false, reason: `Saved plans could not be read: ${loadError}` };
  if (plans.length === 0) return { available: false, reason: "No trade plans yet." };
  const { trades, baseCapital, setups } = useJournal.getState();
  const byId = new Map(trades.map((t) => [t.id, t]));
  const open = plans.filter((p) => p.status === "active" || p.status === "triggered");
  return {
    available: true,
    totalPlans: plans.length,
    statusCounts: statusCounts(plans),
    openPlans: open.map((p) => {
      const t = p.review.tradeId ? byId.get(p.review.tradeId) : undefined;
      const r = t ? computeRealizedR(p, t) : undefined;
      return {
        title: p.title ?? null, symbol: p.symbol, direction: p.direction, status: p.status, timeframe: p.timeframe || null,
        setup: setups.find((s) => s.id === p.setupId)?.name ?? null,
        entryZone: { low: p.entryLow ?? null, high: p.entryHigh ?? null, reference: entryReference(p) ?? null },
        stop: p.stop ?? null, targets: p.targets, plannedRMultiplesOfTargets: plannedRMultiples(p),
        plannedRiskPct: p.riskPct ?? null, plannedRiskUsd: plannedRiskDollars(p.riskPct, baseCapital) ?? null,
        convictionSelfRated1to5: p.conviction ?? null,
        thesisMacro: p.thesisMacro || null, thesisTechnical: p.thesisTechnical || null, catalysts: p.catalysts || null,
        contextSnapshot: p.context ?? null,
        linkedTrade: t ? { entryAt: t.entryAt, result: t.result, realizedR: r?.ok ? r.r : `n/a (${r && !r.ok ? r.reason : "no trade"})` } : null,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      };
    }),
    adherence: adherenceStats(plans, trades),
    note: `Descriptive only. Plans are intentions, not forecasts. Quote the sample size n with every adherence figure. ${R_NOTE} Realized R uses the linked trade's actual entry; plannedRMultiplesOfTargets use the plan's zone midpoint.`,
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

  return { headlines };
}

// ────────────────────────────────────────────────────────────
// get_econ_calendar
// ────────────────────────────────────────────────────────────
// Split out of get_news_headlines: that only ever looked at the current
// Mon–Fri (plus next week, and only if this week had <5 events left), so on a
// busy midweek the copilot couldn't see Friday, let alone the following week.
// This pulls a real N-day window (default 7, matching the Econ Calendar
// module's week view) in a single /economy/calendar call — the same fetcher
// and the same estimateImpact() the UI panel uses, no reimplementation.
async function toolEconCalendar(input: { daysAhead?: number }) {
  const daysAhead = Math.min(Math.max(Math.trunc(input.daysAhead ?? 7), 1), 30);
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + daysAhead);

  const events = await fetchEconCalendar(toYmd(now), toYmd(end))
    .catch((e: Error) => ({ available: false as const, reason: e.message }));
  if (!Array.isArray(events)) return events;

  const upcoming = events
    .filter((e) => new Date(e.date) >= now)
    .map((e) => ({
      date: e.date, country: e.country, event: e.event,
      consensus: e.consensus, previous: e.previous,
      impact: estimateImpact(e),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // A 7-day nasdaq window is 300+ rows, mostly low-impact auctions/energy
  // stats. Keep every high/medium event no matter how far out, then top up
  // with the soonest low-impact ones to a bounded total — so "the next
  // high-impact release" is never the thing that gets truncated away.
  const CAP = 120;
  const notable = upcoming.filter((e) => e.impact !== "low");
  const low = upcoming.filter((e) => e.impact === "low");
  const shown = [...notable, ...low.slice(0, Math.max(0, CAP - notable.length))]
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    rangeStart: toYmd(now),
    rangeEnd: toYmd(end),
    daysAhead,
    impactNote:
      "The impact field is an ESTIMATE (keyword + economy-size heuristic) — " +
      "Nasdaq's free calendar ships no licensed impact rating. Relay it as an " +
      "estimate, never as a definitive high/low call.",
    counts: { total: upcoming.length, notable: notable.length, returned: shown.length },
    lowImpactTruncated: low.length > Math.max(0, CAP - notable.length),
    events: shown,
  };
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
// navigate_to_function  (UI only — no data touched)
// ────────────────────────────────────────────────────────────
// Routes through the same workspaceStore.openTab the command bar's run()
// calls — not a second routing path. Validates the code against the same
// FUNCTIONS directory HELP lists.
function toolNavigate(input: { functionCode?: unknown; symbol?: unknown }) {
  const code = String(input.functionCode ?? "").trim().toUpperCase();
  if (!code) return { navigated: false, error: "No function code given." };
  const def = FUNCTIONS.find((f) => f.code === code);
  if (!def) {
    return {
      navigated: false,
      error: `No function with code "${code}". It isn't in the HELP directory — tell Harold it wasn't found.`,
    };
  }
  const symbol = String(input.symbol ?? "").trim().toUpperCase() || undefined;
  if (def.needsSymbol && !symbol) {
    return {
      navigated: false,
      error: `${code} (${def.name}) needs a symbol — ask Harold which ticker, then call again with { functionCode: "${code}", symbol: "…" }.`,
    };
  }
  useWorkspace.getState().openTab(def.code, def.needsSymbol ? symbol : undefined);
  return { navigated: true, functionCode: def.code, name: def.name, symbol: def.needsSymbol ? symbol ?? null : null };
}

// ────────────────────────────────────────────────────────────
// prefill_track_record_entry  (UI only — fills the form, never saves)
// ────────────────────────────────────────────────────────────
// Drops the parsed fields into tradeDraftStore and navigates to TRACK. The
// TradeForm component seeds its own local state from that draft; the trade is
// only ever written by Harold clicking "Log Trade" (the form's existing
// addTrade path). Nothing here writes to useJournal or localStorage.
function toNum(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO 8601 or "YYYY-MM-DDTHH:mm" -> datetime-local value, or undefined. */
function toDatetimeLocal(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v.trim());
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pickOption(v: unknown, options: string[]): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return options.find((o) => o.toLowerCase() === v.trim().toLowerCase());
}

function toolPrefillTrackRecord(input: Record<string, unknown>) {
  const dirRaw = String(input.direction ?? "").trim().toLowerCase();
  const direction: Direction | undefined =
    dirRaw === "buy" || dirRaw === "long" || dirRaw === "achat" ? "buy"
    : dirRaw === "sell" || dirRaw === "short" || dirRaw === "vente" ? "sell"
    : undefined;

  const entry = toNum(input.entryPrice);
  const exit = toNum(input.exitPrice);
  const size = toNum(input.size);
  const symbolRaw = typeof input.symbol === "string" && input.symbol.trim() ? input.symbol.trim().toUpperCase() : undefined;
  const symbol = symbolRaw ?? "XAU/USD";

  const draft: TradeDraft = {
    symbol,
    direction,
    size: size != null ? String(size) : undefined,
    entryPrice: entry != null ? String(entry) : undefined,
    exitPrice: exit != null ? String(exit) : undefined,
    entryAt: toDatetimeLocal(input.entryAt),
    exitAt: toDatetimeLocal(input.exitAt),
    setupName: typeof input.setup === "string" && input.setup.trim() ? input.setup.trim() : undefined,
    macroBias: pickOption(input.macroBias, MACRO_BIAS_OPTIONS),
    conviction: pickOption(input.conviction, CONVICTION_OPTIONS),
    newsEvent: typeof input.newsEvent === "string" && input.newsEvent.trim() ? input.newsEvent.trim() : undefined,
    feeling: typeof input.feeling === "string" && input.feeling.trim() ? input.feeling.trim() : undefined,
    notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : undefined,
  };

  useTradeDraft.getState().setDraft(draft);
  useWorkspace.getState().openTab("TRACK");

  const prefilled = Object.entries({
    symbol: draft.symbol,
    direction: draft.direction,
    size: draft.size,
    entryPrice: draft.entryPrice,
    exitPrice: draft.exitPrice,
    entryAt: draft.entryAt,
    exitAt: draft.exitAt,
    setup: draft.setupName,
    macroBias: draft.macroBias,
    conviction: draft.conviction,
    newsEvent: draft.newsEvent,
    feeling: draft.feeling,
    notes: draft.notes,
  }).filter(([, v]) => v != null).map(([k]) => k);

  const left = ["direction", "size", "entryPrice", "exitPrice"].filter((k) => !prefilled.includes(k));

  return {
    prefilled: true,
    saved: false,
    note: "The 'Log a Trade' form is now pre-filled but NOT submitted. Tell Harold exactly what you pre-filled and that he must review and click Log Trade to save it — do not say the trade is logged/saved.",
    fieldsPrefilled: prefilled,
    fieldsLeftBlank: left,
    draft,
  };
}


// ────────────────────────────────────────────────────────────
// get_market_lean — wraps lib/lean (the LEAN page's own engine + cached bundle)
// ────────────────────────────────────────────────────────────
async function toolMarketLean(input: { instrument?: string }) {
  let out;
  try { out = await getMarketLeanResults(); }
  catch (e) { return { available: false, error: (e as Error).message }; }
  const { bundle, results } = out;
  const ha = historicalAgreement(input.instrument);
  const meta = {
    note: "Context only, not financial advice. Rule-based, from daily data; not a forecast and not a trade signal.",
    backdropThreshold: LEAN_THRESHOLD,
    driverAgreementNote: DRIVER_AGREEMENT_NOTE,
    historicalAgreement: ha.text,
    historicalAgreementCaveat: ha.caveat,
    baseWeights: BASE_WEIGHTS, walkForwardMultiplier: WALK_FORWARD_MULT,
    walkForward: "Walk-forward agreement is close to chance and not statistically significant for the combined backdrop and most drivers; drivers without demonstrated edge carry weight 0 but are still shown. Never describe the backdrop as predictive.",
    goldSource: GOLD_SOURCE_NOTE,
    inputsThatFailed: bundle.seriesErrors, cotError: bundle.cotError ?? null, fetchedAt: bundle.fetchedAt,
  };
  const round = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  const agreement = (r: (typeof results)[number]) => (r.driverAgreement == null
    ? { driverAgreement: null, driverAgreementDisplay: r.label === "No data" ? "n/a" : `n/a (${r.weightedDriverCount === 0 ? "no" : "one"} weighted driver)` }
    : { driverAgreement: r.driverAgreement, driverAgreementDisplay: `${r.driverAgreement}/100` });
  if (input.instrument) {
    const r = results.find((x) => x.instrumentId === input.instrument);
    if (!r) return { available: false, error: `Unknown instrument "${input.instrument}". Valid: ${INSTRUMENTS.map((i) => i.id).join(", ")}.` };
    const inst = INSTRUMENTS.find((i) => i.id === r.instrumentId)!;
    return {
      available: true, instrument: r.instrumentId, backdropName: r.backdropName, backdrop: r.label, composite: round(r.composite),
      ...agreement(r), dataCompleteness: round(r.completeness), confirmers: r.confirmers,
      historySource: inst.sourceNote ?? null,
      drivers: r.drivers.map((d) => ({
        driver: d.label, score: round(d.score), direction: d.direction, baseWeight: d.baseWeight, walkForwardMultiplier: d.multiplier, weight: round(d.weight),
        displayOnly: d.displayOnly, note: d.note, historicalNote: driverHistoryNote(d.id),
        inputs: d.components.map((c) => ({ input: c.label, raw: c.raw, score: round(c.score), direction: c.direction, missing: c.missing })),
      })),
      whatWouldChangeIt: r.flips.map((f) => f.text), warnings: r.warnings, freshness: r.freshness, meta,
    };
  }
  return {
    available: true,
    instruments: results.map((r) => ({ instrument: r.instrumentId, backdropName: r.backdropName, backdrop: r.label, composite: round(r.composite), ...agreement(r), lastBar: r.freshness.ownLastBar, historySource: INSTRUMENTS.find((i) => i.id === r.instrumentId)!.sourceNote ?? null, warnings: r.warnings.length })),
    meta,
  };
}

// ────────────────────────────────────────────────────────────
// get_macro_snapshot — wraps lib/macro (the MACRO page's own views + cached snapshot)
// ────────────────────────────────────────────────────────────
async function toolMacroSnapshot(input: { economy?: unknown }) {
  const code = input.economy == null || input.economy === "" ? undefined : String(input.economy).toUpperCase();
  const economy = ECONOMIES.find((e) => e.id === code)?.id;
  if (code && !economy) return { available: false, error: `Unknown economy "${code}". Valid: ${ECONOMIES.map((e) => e.id).join(", ")}.` };
  let snap;
  try { snap = await getMacroSnapshot(); }
  catch (e) { return { available: false, error: (e as Error).message }; }
  return macroSummary(buildViews(snap, Date.now()), snap, economy);
}

// ────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────
export async function runCopilotTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_scalper_snapshot": return toolScalperSnapshot();
    case "get_cot_positioning": return toolCotPositioning(input);
    case "get_macro_snapshot": return toolMacroSnapshot(input);
    case "get_market_lean": return toolMarketLean(input as { instrument?: string });
    case "get_track_record_stats": return toolTrackRecordStats(input);
    case "get_trade_plans": return toolTradePlans();
    case "get_news_headlines": return toolNewsHeadlines(input);
    case "get_econ_calendar": return toolEconCalendar(input);
    case "get_portfolio_snapshot": return toolPortfolioSnapshot();
    case "navigate_to_function": return toolNavigate(input);
    case "prefill_track_record_entry": return toolPrefillTrackRecord(input);
    default: throw new Error(`Unknown tool "${name}"`);
  }
}
