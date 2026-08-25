import { INDICES } from "@/lib/indices";
import { UNIVERSE } from "@/lib/universe";
import { COINS } from "@/lib/crypto";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(public status: number, message: string, public needsKey?: string) {
    super(message);
  }
}

async function get<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${BASE}${path}?${qs.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.detail;
    let msg = res.statusText;
    let needsKey: string | undefined;
    if (typeof detail === "string") msg = detail;
    else if (Array.isArray(detail)) msg = detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ");
    const m = /credential '([a-z_]+)'/i.exec(msg);
    if (m) needsKey = m[1];
    throw new ApiError(res.status, msg, needsKey);
  }
  return body.results as T;
}

// ────── Equity ──────
export interface Quote {
  symbol: string; name?: string; exchange?: string;
  last_price?: number; open?: number; high?: number; low?: number; prev_close?: number;
  bid?: number; ask?: number; bid_size?: number; ask_size?: number;
  volume?: number; volume_average?: number; year_high?: number; year_low?: number;
  ma_50d?: number; ma_200d?: number; currency?: string; market_cap?: number;
  change?: number; change_percent?: number;
}
export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number; }
export interface NewsItem { id: string; date: string; title: string; url: string; source?: string; summary?: string; symbol?: string; }
export interface Profile {
  symbol: string; name?: string; stock_exchange?: string; long_description?: string;
  company_url?: string; business_phone_no?: string;
  hq_address1?: string; hq_address_city?: string; hq_state?: string; hq_country?: string; hq_address_postal_code?: string;
  employees?: number; sector?: string; industry_category?: string; issue_type?: string; currency?: string;
  market_cap?: number; shares_outstanding?: number; shares_float?: number;
  dividend_yield?: number; beta?: number;
}
export interface IncomeRow {
  period_ending: string;
  total_revenue?: number; cost_of_revenue?: number; gross_profit?: number;
  operating_income?: number; total_pre_tax_income?: number; net_income?: number;
  basic_earnings_per_share?: number; diluted_earnings_per_share?: number;
  research_and_development_expense?: number; selling_general_and_admin_expense?: number;
}
export interface Metrics {
  symbol: string; market_cap?: number; pe_ratio?: number; forward_pe?: number; peg_ratio?: number;
  enterprise_to_ebitda?: number; revenue_growth?: number; earnings_growth?: number;
  quick_ratio?: number; current_ratio?: number; debt_to_equity?: number;
  gross_margin?: number; operating_margin?: number; profit_margin?: number;
  return_on_assets?: number; return_on_equity?: number;
  dividend_yield?: number; payout_ratio?: number; book_value?: number; price_to_book?: number;
  enterprise_value?: number;
}
export interface Dividend { ex_dividend_date: string; amount: number; }
export interface ConsensusEstimate {
  symbol: string; target_high?: number; target_low?: number; target_consensus?: number;
  target_median?: number; recommendation?: string; recommendation_mean?: number;
  number_of_analysts?: number; current_price?: number; currency?: string;
}
export interface Mover {
  symbol: string; name?: string; price: number; change: number; percent_change: number;
  volume: number; market_cap?: number; pe_forward?: number; eps_ttm?: number;
  dividend_yield?: number; exchange?: string; earnings_date?: string;
}
export interface SearchResult { symbol: string; name: string; cik?: string; }
export interface OptionsRow {
  underlying_symbol: string; underlying_price?: number; contract_symbol: string;
  expiration: string; dte: number; strike: number; option_type: "call" | "put";
  open_interest?: number; volume?: number; last_trade_price?: number;
  bid?: number; ask?: number; change?: number; change_percent?: number;
  implied_volatility?: number; in_the_money?: boolean;
}
export interface TreasuryRow {
  date: string; month_1?: number; month_3?: number; month_6?: number;
  year_1?: number; year_2?: number; year_3?: number; year_5?: number; year_7?: number;
  year_10?: number; year_20?: number; year_30?: number;
}

// Fetchers
export const fetchQuote = (s: string) =>
  get<Quote[] | Quote>("/equity/price/quote", { symbol: s, provider: "yfinance" })
    .then((r) => (Array.isArray(r) ? r[0] : r));

export const fetchHistorical = (s: string, o: { interval?: string; start_date?: string } = {}) => {
  const start = o.start_date ?? new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  return get<Candle[]>("/equity/price/historical", {
    symbol: s, provider: "yfinance", interval: o.interval ?? "1d", start_date: start,
  });
};

export const fetchNewsCompany = (s: string, limit = 30) =>
  get<NewsItem[]>("/news/company", { symbol: s, provider: "yfinance", limit });

// ────── News Hub category feeds ──────
// `/news/world` (a real general-news endpoint) only accepts benzinga/biztoc/
// fmp/intrinio/tiingo on this install, and every one of those needs a paid/
// keyed credential this app doesn't have — verified directly against the
// running openbb-api server. Same free workaround as fetchForexNews below:
// aggregate `/news/company` (yfinance, no key) over a representative basket,
// dedupe by url/title, sort newest-first. Baskets reuse existing single-
// source-of-truth lists rather than new hardcoded ones.
export async function aggregateCompanyNews(
  symbols: string[],
  opts: { perSymbol?: number; limit?: number } = {}
): Promise<NewsItem[]> {
  const perSymbol = opts.perSymbol ?? 10;
  const limit = opts.limit ?? 40;
  const batches = await Promise.all(
    symbols.map((s) => fetchNewsCompany(s, perSymbol).catch(() => [] as NewsItem[]))
  );
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const batch of batches) {
    for (const n of batch) {
      const key = (n.url || n.title || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(n);
    }
  }
  merged.sort((a, b) => (a.date > b.date ? -1 : 1));
  return merged.slice(0, limit);
}

const GENERAL_NEWS_SYMBOLS = INDICES.map((i) => i.etf).filter((s): s is string => !!s);
const STOCKS_NEWS_SYMBOLS = [...UNIVERSE]
  .sort((a, b) => b.marketCap - a.marketCap)
  .slice(0, 8)
  .map((c) => c.symbol);
const CRYPTO_NEWS_SYMBOLS = COINS.slice(0, 8).map((c) => c.sym);

export const fetchGeneralNews = (limit = 40) => aggregateCompanyNews(GENERAL_NEWS_SYMBOLS, { perSymbol: 10, limit });
export const fetchStocksNews = (limit = 40) => aggregateCompanyNews(STOCKS_NEWS_SYMBOLS, { perSymbol: 8, limit });
export const fetchCryptoNews = (limit = 40) => aggregateCompanyNews(CRYPTO_NEWS_SYMBOLS, { perSymbol: 10, limit });

export const fetchProfile = (s: string) =>
  get<Profile[] | Profile>("/equity/profile", { symbol: s, provider: "yfinance" })
    .then((r) => (Array.isArray(r) ? r[0] : r));

export const fetchIncome = (s: string) =>
  get<IncomeRow[]>("/equity/fundamental/income", {
    symbol: s, provider: "yfinance", period: "annual", limit: 5,
  });

export const fetchMetrics = (s: string) =>
  get<Metrics[] | Metrics>("/equity/fundamental/metrics", { symbol: s, provider: "yfinance" })
    .then((r) => (Array.isArray(r) ? r[0] : r));

export const fetchDividends = (s: string) =>
  get<Dividend[]>("/equity/fundamental/dividends", { symbol: s, provider: "yfinance" });

export const fetchConsensus = (s: string) =>
  get<ConsensusEstimate[] | ConsensusEstimate>("/equity/estimates/consensus", {
    symbol: s, provider: "yfinance",
  }).then((r) => (Array.isArray(r) ? r[0] : r));

export const fetchGainers = () =>
  get<Mover[]>("/equity/discovery/gainers", { provider: "yfinance" });
export const fetchLosers = () =>
  get<Mover[]>("/equity/discovery/losers", { provider: "yfinance" });
export const fetchMostActive = () =>
  get<Mover[]>("/equity/discovery/active", { provider: "yfinance" });

export const fetchOptions = (s: string) =>
  get<OptionsRow[]>("/derivatives/options/chains", { symbol: s, provider: "yfinance" });

export const fetchIndexHistorical = (s: string, days = 30, interval = "1d") => {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return get<Candle[]>("/index/price/historical", {
    symbol: s, provider: "yfinance", interval, start_date: start,
  });
};

export const fetchTreasuryRates = (days = 30) => {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return get<TreasuryRow[]>("/fixedincome/government/treasury_rates", {
    provider: "federal_reserve", start_date: start,
  });
};

export const fetchFxHistorical = (pair: string, days = 30, interval = "1d") => {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return get<Candle[]>("/currency/price/historical", {
    symbol: pair, provider: "yfinance", interval, start_date: start,
  });
};

// ────── Timestamp normalization ──────
// openbb_yfinance fetches intraday candles with `ignore_tz=True`, which
// strips the tz label but keeps the *exchange-local* wall clock — verified
// directly against yfinance: GC=F/SI=F/ES=F/NQ=F/DX-Y.NYB are tagged
// America/New_York, every `=X` currency pair is tagged Europe/London,
// regardless of where the app is running. A naive string like
// "2026-08-20T09:25:00" then gets parsed by `new Date()` as the *browser's*
// local time, not the exchange's — e.g. a browser in CEST (UTC+2) reading a
// fresh America/New_York (UTC-4) candle miscomputes its age as 6 hours too
// old. That's the exact cause of the XAU scalper's "STALE — 6h OLD" badge:
// the candle was ~10 minutes old, not 6 hours; the detector was reading a
// mis-parsed timestamp. Normalize to true UTC once, here, at the fetch
// boundary, so every consumer (board, tape, scalper, chart) works with real
// instants.
const EXCHANGE_TZ: Record<"metal" | "fx", string> = {
  metal: "America/New_York",
  fx: "Europe/London",
};

function exchangeLocalToUtcIso(naive: string, tz: string): string {
  const guess = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(naive) ? naive : naive + "Z");
  if (Number.isNaN(guess.getTime())) return naive;
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(guess)) parts[p.type] = p.value;
  const h = parts.hour === "24" ? 0 : +parts.hour;
  // What the naive digits would mean if `tz`'s current offset applied.
  const wallAsUtcMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, h, +parts.minute, +parts.second);
  const offsetMs = wallAsUtcMs - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

// ────── Forex / metals ──────
// FX pairs and metal futures have no real `last_price` on the quote endpoint,
// so the whole FX board is priced off intraday candles instead (see lib/forex).
/**
 * Intraday candles for a single instrument — the single price source for the
 * FX board, ticker tape, and XAU scalper (last + day range + ATR). Metals and
 * index futures route through the equity endpoint, FX pairs through currency.
 */
export const fetchIntraday = (
  symbol: string,
  opts: { interval?: string; kind?: "metal" | "fx"; days?: number; bust?: boolean } = {}
) => {
  const days = opts.days ?? 2;
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const path = opts.kind === "fx" ? "/currency/price/historical" : "/equity/price/historical";
  const tz = EXCHANGE_TZ[opts.kind === "fx" ? "fx" : "metal"];
  return get<Candle[]>(path, {
    symbol, provider: "yfinance", interval: opts.interval ?? "5m", start_date: start,
    // A distinct query string is a distinct cache key in the Vite proxy —
    // this is the "forced cache-bust" escape hatch for a card that's been
    // stuck stale past the threshold (see useStaleBust in lib/forex.ts).
    ...(opts.bust ? { _bust: Date.now() } : {}),
  }).then((candles) => candles.map((c) => ({ ...c, date: exchangeLocalToUtcIso(c.date, tz) })));
};

/**
 * Forex/macro news: yfinance has no dedicated forex feed, but company-news on
 * FX/metals tickers returns genuinely currency-relevant headlines (Fed, dollar,
 * gold). Aggregate a basket, dedupe, sort newest-first. No API key required.
 */
const FX_NEWS_SYMBOLS = ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "GC=F", "SI=F", "DX-Y.NYB"];
export const fetchForexNews = (limit = 40) => aggregateCompanyNews(FX_NEWS_SYMBOLS, { perSymbol: 15, limit });

export const fetchCryptoHistorical = (sym: string, days = 30) => {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return get<Candle[]>("/crypto/price/historical", {
    symbol: sym, provider: "yfinance", interval: "1d", start_date: start,
  });
};

export const searchSymbols = (q: string, limit = 8) =>
  get<SearchResult[]>("/equity/search", { query: q, provider: "sec", limit, is_symbol: false });

// ────── Batched quotes (Quote Cards / Heatmap) ──────
/**
 * Batched multi-symbol quotes. The yfinance quote endpoint accepts a
 * comma-separated symbol list, so we chunk the universe into a handful of
 * requests instead of one-per-ticker. Failed chunks are skipped, not fatal —
 * a partial board is better than none. Callers derive % change from
 * (last_price - prev_close) / prev_close.
 */
export async function fetchQuotes(symbols: string[], chunk = 40): Promise<Quote[]> {
  const uniq = Array.from(new Set(symbols.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += chunk) chunks.push(uniq.slice(i, i + chunk));
  const batches = await Promise.all(
    chunks.map((c) =>
      get<Quote[] | Quote>("/equity/price/quote", { symbol: c.join(","), provider: "yfinance" })
        .then((r) => (Array.isArray(r) ? r : [r]))
        .catch(() => [] as Quote[])
    )
  );
  return batches.flat();
}

// ────── Commodities ──────
/** Daily history for a commodity future (routes through the equity endpoint). */
export const fetchCommodityHistorical = (sym: string, days = 30) => {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return get<Candle[]>("/equity/price/historical", {
    symbol: sym, provider: "yfinance", interval: "1d", start_date: start,
  });
};

// ────── Extended-hours (after-hours / pre-market) proxy ──────
/**
 * Intraday candles for a tracking ETF *including* pre/post-market, used to
 * approximate an index's extended-hours move (indices themselves don't trade
 * after the bell). Returns the raw candle series; `extendedHoursMove` derives
 * the after-hours %.
 */
export const fetchEtfExtended = (sym: string, days = 2) => {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return get<Candle[]>("/equity/price/historical", {
    symbol: sym, provider: "yfinance", interval: "15m",
    start_date: start, extended_hours: true,
  });
};

/** Hour-of-day (0-23) at a US-market wall clock for an ISO timestamp. */
function etHour(iso: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", hour12: false,
    }).formatToParts(new Date(iso)).find((p) => p.type === "hour")?.value;
    const n = h === "24" ? 0 : Number(h);
    return Number.isFinite(n) ? n : -1;
  } catch { return -1; }
}

export interface ExtendedHours {
  /** last traded price including post-market */
  last?: number;
  /** the 16:00 ET regular-session close on the latest day */
  regularClose?: number;
  /** after-hours % vs the regular close */
  changePct?: number;
  /** "pre" (before 09:30) or "post" (after 16:00), when applicable */
  session?: "pre" | "post";
}

/**
 * Derive the extended-hours move from an ETF's extended intraday series.
 * Regular close = last candle on the latest day at/before 16:00 ET; the
 * after-hours print is any candle after it. Returns empty fields when the
 * provider gives no extended candles (common during regular hours / weekends).
 */
export function extendedHoursMove(candles?: Candle[]): ExtendedHours {
  if (!candles || candles.length === 0) return {};
  const lastDay = candles[candles.length - 1].date.slice(0, 10);
  const day = candles.filter((c) => c.date.slice(0, 10) === lastDay);
  let regularClose: number | undefined;
  let afterIdx = -1;
  for (let i = 0; i < day.length; i++) {
    const h = etHour(day[i].date);
    if (h >= 0 && h < 16) { regularClose = day[i].close; }
    else if (h >= 16 && afterIdx === -1) { afterIdx = i; }
  }
  const lastC = day[day.length - 1];
  const lastH = etHour(lastC.date);
  const isExtended = lastH >= 16 || lastH < 9;
  if (!isExtended || regularClose == null) return { regularClose };
  const last = lastC.close;
  const changePct = ((last - regularClose) / regularClose) * 100;
  return { last, regularClose, changePct, session: lastH < 9 ? "pre" : "post" };
}

// ────── Spot metals (Twelve Data) ──────
// GC=F/SI=F on the equity endpoint are COMEX *futures*, not spot — they
// track XAU/USD closely but carry a basis premium that made the scalper/
// board/tape numbers not match GP's TradingView chart (which reads real
// OANDA spot). Twelve Data's free tier serves real spot XAU/USD directly
// (verified against the live API); XAG/USD 404s on the free tier ("Grow or
// Venture plan" required), so silver stays on SI=F futures.
export const SPOT_GOLD_SYMBOL = "XAU/USD";

export interface SpotQuote {
  symbol: string;
  last?: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  /** real Unix-epoch ISO timestamp of the quote — Twelve Data's `last_quote_at`
   * is a true epoch second, unlike yfinance's naive exchange-local strings. */
  asOf?: string;
}

export const fetchSpotQuote = async (symbol: string): Promise<SpotQuote> => {
  const res = await fetch(`/spot-proxy/quote?symbol=${encodeURIComponent(symbol)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.results) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to load spot quote");
  }
  const r = body.results;
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  return {
    symbol: r.symbol ?? symbol,
    last: num(r.close),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    prevClose: num(r.previous_close),
    asOf: r.last_quote_at ? new Date(r.last_quote_at * 1000).toISOString() : undefined,
  };
};

/** OHLC candle series for a spot symbol (ATR only — the day-range numbers
 * come from fetchSpotQuote, which is cheaper on Twelve Data's rate limit). */
export const fetchSpotSeries = async (symbol: string, interval = "5min"): Promise<Candle[]> => {
  const res = await fetch(`/spot-proxy/series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
  const body = await res.json().catch(() => ({}));
  const values = body?.results?.values;
  if (!res.ok || !Array.isArray(values)) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to load spot series");
  }
  return values
    .slice()
    .reverse() // Twelve Data returns newest-first; candle consumers (ATR) expect chronological order
    .map((v: Record<string, string>) => ({
      date: v.datetime,
      open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
      volume: 0,
    }));
};

// ────── COT (Commitments of Traders) — gold ──────
export interface CotSnapshot {
  /** date of the CFTC Tuesday snapshot this report covers */
  asOf: string;
  openInterest: number;
  nonCommercialLong: number;
  nonCommercialShort: number;
  /** week-over-week change vs the prior report */
  nonCommercialLongChange: number;
  nonCommercialShortChange: number;
}

export type CotContract = "gold" | "crude" | "eurusd" | "spx";
export const COT_CONTRACT_LABELS: Record<CotContract, string> = {
  gold: "Gold",
  crude: "WTI Crude",
  eurusd: "EUR FX",
  spx: "E-mini S&P 500",
};

/**
 * COT positioning (legacy futures-only report, Non-Commercial /
 * "large speculator" category), sourced from Tradingster's CFTC mirror via
 * the dev-server proxy in vite.config.ts (Tradingster's page has no API and
 * no CORS headers, so this can't be fetched directly from the browser).
 */
export const fetchCot = async (contract: CotContract): Promise<CotSnapshot> => {
  const res = await fetch(`/cot-proxy/${contract}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.results) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to load COT data");
  }
  return body.results as CotSnapshot;
};

export const fetchGoldCot = () => fetchCot("gold");

// ────── News Hub — Pass 2 calendars ──────
// All free via `nasdaq`/`federal_reserve`/`yfinance` providers — no API key.
export interface EconCalendarEvent {
  date: string; country: string; event: string;
  actual?: string; consensus?: string; previous?: string; description?: string;
}
export const fetchEconCalendar = (startDate: string, endDate: string) =>
  get<EconCalendarEvent[]>("/economy/calendar", {
    provider: "nasdaq", start_date: startDate, end_date: endDate,
  });

export interface EarningsEvent {
  report_date: string; symbol: string; name?: string;
  eps_previous?: number; eps_consensus?: number; num_estimates?: number;
  period_ending?: string; reporting_time?: "pre-market" | "after-hours" | "not-supplied";
  market_cap?: number;
}
export const fetchEarningsCalendar = (startDate: string, endDate: string) =>
  get<EarningsEvent[]>("/equity/calendar/earnings", {
    provider: "nasdaq", start_date: startDate, end_date: endDate,
  });

export interface DividendCalendarEvent {
  ex_dividend_date: string; symbol: string; name?: string; amount: number;
  record_date?: string; payment_date?: string; declaration_date?: string;
  annualized_amount?: number;
}
export const fetchDividendCalendar = (startDate: string, endDate: string) =>
  get<DividendCalendarEvent[]>("/equity/calendar/dividend", {
    provider: "nasdaq", start_date: startDate, end_date: endDate,
  });

export interface IpoCalendarEvent {
  symbol?: string; ipo_date: string; name?: string;
  offer_amount?: number; share_count?: number; share_price?: string;
  deal_status?: string; exchange?: string;
}
export const fetchIpoCalendar = (startDate: string, endDate: string) =>
  get<IpoCalendarEvent[]>("/equity/calendar/ipo", {
    provider: "nasdaq", start_date: startDate, end_date: endDate,
  });

/** Stock splits calendar — OpenBB only exposes this via `fmp`, which needs a
 * paid/free-tier `fmp_api_key` (set `OPENBB_FMP_API_KEY` before starting
 * openbb-api). Left wired against the real endpoint so it lights up the
 * moment a key is added; throws a typed ApiError with `needsKey` set until
 * then, which CorporatePanel renders as an explicit gap, not fake data. */
export interface StockSplitEvent {
  date: string; symbol: string; name?: string;
  old_shares?: number; new_shares?: number;
}
export const fetchStockSplits = (startDate: string, endDate: string) =>
  get<StockSplitEvent[]>("/equity/calendar/splits", {
    start_date: startDate, end_date: endDate,
  });

// ────── Balance sheet / cash flow (Equity Research deep-dive) ──────
// Free via yfinance — no key required. Powers the DCF/Intrinsic Value
// valuation module and the balance-sheet decomposition visual.
export interface BalanceRow {
  period_ending: string;
  total_assets?: number; total_current_assets?: number; total_non_current_assets?: number;
  total_liabilities_net_minority_interest?: number; current_liabilities?: number;
  total_non_current_liabilities_net_minority_interest?: number;
  total_common_equity?: number; common_stock_equity?: number;
  cash_and_cash_equivalents?: number; total_debt?: number; net_debt?: number;
  ordinary_shares_number?: number; tangible_book_value?: number; working_capital?: number;
}
export const fetchBalance = (s: string, limit = 5) =>
  get<BalanceRow[]>("/equity/fundamental/balance", { symbol: s, provider: "yfinance", period: "annual", limit });

export interface CashFlowRow {
  period_ending: string;
  operating_cash_flow?: number; capital_expenditure?: number; free_cash_flow?: number;
  depreciation_and_amortization?: number; stock_based_compensation?: number;
  cash_dividends_paid?: number; repurchase_of_common_equity?: number;
}
export const fetchCashFlow = (s: string, limit = 5) =>
  get<CashFlowRow[]>("/equity/fundamental/cash", { symbol: s, provider: "yfinance", period: "annual", limit });

// ────── Peers (Equity Research — Peers tab) ──────
// Free on the FMP tier this app has configured (verified live — unlike
// major_holders/institutional/price_target below, this specific endpoint
// is not premium-gated).
export interface PeerQuote { symbol: string; name?: string; price?: number; market_cap?: number; }
export const fetchPeers = (s: string) =>
  get<PeerQuote[]>("/equity/compare/peers", { symbol: s, provider: "fmp" });

// ────── Analyst rating changes (Equity Research — Ratings tab) ──────
// finviz is free (no key) and covers upgrade/downgrade history with firm
// name + date; fmp's equivalent endpoint is restricted on the free tier
// (verified live — 402 "Restricted Endpoint").
export interface RatingChange {
  published_date: string; symbol: string;
  price_target?: number | null; adj_price_target?: number;
  status?: string; rating_change?: string; analyst_company?: string;
}
export const fetchRatingChanges = (s: string, limit = 30) =>
  get<RatingChange[]>("/equity/estimates/price_target", { symbol: s, provider: "finviz", limit });

// ────── Ownership (Equity Research — Ownership tab) ──────
// Insider transactions are free via SEC (Form 4 filings, no key).
export interface InsiderTx {
  symbol: string; filing_date: string; transaction_date?: string;
  owner_name?: string; owner_title?: string; transaction_type?: string;
  acquisition_or_disposition?: string; securities_owned?: number;
  securities_transacted?: number; transaction_price?: number;
  form?: string; officer?: boolean; director?: boolean; filing_url?: string;
}
export const fetchInsiderTrading = (s: string, limit = 50) =>
  get<InsiderTx[]>("/equity/ownership/insider_trading", { symbol: s, provider: "sec", limit });

/**
 * Ownership %, short interest, and institution count — all free via
 * yfinance's share_statistics. This covers the institutional/insider/public
 * split without needing the paid FMP major_holders/institutional endpoints
 * (verified live — those 402 "Restricted Endpoint" on the free tier).
 */
export interface ShareStatistics {
  symbol: string; date?: string;
  float_shares?: number; outstanding_shares?: number;
  short_interest?: number; short_percent_of_float?: number; days_to_cover?: number;
  insider_ownership?: number; institution_ownership?: number;
  institution_float_ownership?: number; institutions_count?: number;
}
export const fetchShareStatistics = (s: string) =>
  get<ShareStatistics[] | ShareStatistics>("/equity/ownership/share_statistics", { symbol: s, provider: "yfinance" })
    .then((r) => (Array.isArray(r) ? r[0] : r));

/** Effective Federal Funds Rate, daily — free via the Fed's own H.15
 * release (no key). Used as the "R_before" anchor for the FedWatch calc. */
export interface EffrPoint {
  date: string; rate: number; target_range_upper?: number; target_range_lower?: number;
}
export const fetchEffr = (startDate: string) =>
  get<EffrPoint[]>("/fixedincome/rate/effr", { provider: "federal_reserve", start_date: startDate });

/** 30-Day Fed Funds futures (CBOT symbol ZQ) curve — free via yfinance.
 * Price = 100 - implied average daily EFFR for that contract month; this is
 * the same raw input CME's FedWatch tool is built on. */
export interface FuturesCurvePoint { expiration: string; price: number; }
export const fetchFedFundsCurve = () =>
  get<FuturesCurvePoint[]>("/derivatives/futures/curve", { symbol: "ZQ", provider: "yfinance" });

/** Historical close for one ZQ contract month, used to reconstruct what the
 * implied odds looked like as of a past date (e.g. right after the last
 * FOMC meeting), so FedWatchPanel can show how odds have shifted since. */
export const fetchFedFundsContractHistory = (expirationYYYYMM: string, startDate: string, endDate: string) =>
  get<Candle[]>("/derivatives/futures/historical", {
    symbol: "ZQ", provider: "yfinance", expiration: expirationYYYYMM,
    start_date: startDate, end_date: endDate, interval: "1d",
  });

// ────── Investors / Institutional (13F, insider, congress) ──────
// 13F holdings and institution name search are both free via the SEC
// provider (no key) — verified live against the running backend, unlike
// `institutional`/`major_holders`/`government_trades`, which are FMP-only
// and 402 "Restricted Endpoint" on this app's free tier.
export interface Holding13F {
  period_ending: string; issuer: string; cusip: string; asset_class: string;
  security_type?: string; investment_discretion?: string;
  voting_authority_sole?: number; principal_amount?: number;
  value: number; weight: number;
}
export const fetch13F = (cik: string, opts: { date?: string; limit?: number } = {}) =>
  get<Holding13F[]>("/equity/ownership/form_13f", {
    symbol: cik, provider: "sec", date: opts.date, limit: opts.limit ?? 1,
  });

export const searchInstitutions = (query: string) =>
  get<SearchResult[]>("/regulators/sec/institutions_search", { query, provider: "sec" });

/**
 * Market-wide Form 4 feed (Investors > Insider Trading tab) — aggregates
 * `fetchInsiderTrading` (already used per-symbol by RESEARCH's Ownership tab)
 * over a market-cap-weighted basket, same dedupe/sort pattern as
 * `aggregateCompanyNews`. Capped basket size: each symbol is a separate SEC
 * call, and the dev-server proxy caps upstream concurrency at 6.
 */
export async function aggregateInsiderTrading(symbols: string[], perSymbol = 15): Promise<InsiderTx[]> {
  // Firing all symbols at once (originally tested at 60) swamped SEC's
  // per-IP rate limit through the shared upstream — most of the fan-out came
  // back 500/502 instead of real data. Small sequential chunks stay under
  // that limit; each symbol's own failure is still caught individually
  // below, so one bad chunk never blanks the whole feed.
  const CHUNK = 8;
  const batches: InsiderTx[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((s) => fetchInsiderTrading(s, perSymbol).catch(() => [] as InsiderTx[])));
    batches.push(...results);
  }
  const seen = new Set<string>();
  const merged: InsiderTx[] = [];
  for (const batch of batches) {
    for (const t of batch) {
      const key = t.filing_url || `${t.symbol}-${t.owner_name}-${t.filing_date}-${t.securities_transacted}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
  }
  merged.sort((a, b) => (a.filing_date > b.filing_date ? -1 : 1));
  return merged;
}

/**
 * Congressional trading disclosures (STOCK Act). OpenBB's `government_trades`
 * is FMP-only and 402-restricted on this app's free tier; Quiver
 * Quantitative's API needs a paid plan even for the free-tier dashboard's
 * underlying data. CongressInvests (congressinvests.com) is a genuinely free,
 * no-key, CORS-enabled aggregator of House/Senate STOCK Act filings — proxied
 * server-side (see vite.config.ts) to add response caching against its
 * 100-requests/day free quota, not because of a CORS/key requirement.
 */
export interface CongressTrade {
  member: string; chamber: "House" | "Senate"; ticker: string;
  trade_type: string; amount: string; tx_date: string; disclosed: string;
  asset?: string; link?: string;
}
export const fetchCongressTrades = async (): Promise<CongressTrade[]> => {
  const res = await fetch("/congress-proxy/trades");
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.results)) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to load congressional trades");
  }
  return body.results as CongressTrade[];
};

// ────── Prediction markets (Polymarket) ──────
// Public read-only Gamma API, no key — but no CORS headers either, so it's
// fetched through the dev-server proxy in vite.config.ts, same pattern as
// the COT/spot-metals proxies above.
export interface PredictionMarket {
  id: string; question: string; category: string;
  probability: number; probabilityWeekAgo?: number;
  volume: number; liquidity: number; resolveDate: string; url: string;
}
export const fetchPredictionMarkets = async (): Promise<PredictionMarket[]> => {
  const res = await fetch("/polymarket-proxy/events");
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.results)) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to load prediction markets");
  }
  return body.results as PredictionMarket[];
};

// ────── Quant service (Analytics — Cointegration / Z-Score) ──────
// Engle-Granger cointegration test. The frontend date-aligns both closes
// series itself (same join logic every other correlation panel already
// uses) and posts the two aligned arrays to the local quant_service process
// via the dev-server proxy in vite.config.ts — statsmodels' ADF-on-residuals
// implementation is what's actually being reused here, not reimplemented in
// JS.
export interface CointegrationResult {
  score: number;
  pvalue: number;
  critical_values: { "1%": number; "5%": number; "10%": number };
  hedge_ratio: number;
  intercept: number;
  cointegrated_95: boolean;
}
export const fetchCointegration = async (a: number[], b: number[]): Promise<CointegrationResult> => {
  const res = await fetch("/quant-proxy/cointegration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a, b }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.results) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to run cointegration test");
  }
  return body.results as CointegrationResult;
};
