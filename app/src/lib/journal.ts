// ────────────────────────────────────────────────────────────
// Track Record — trading journal. Local-only, never broker-synced (see
// store/journalStore.ts): every trade here is either typed in by hand or
// pasted from a broker export, and stays that way.
// ────────────────────────────────────────────────────────────

export type Direction = "buy" | "sell";
export type TradeSource = "manual" | "import";

export interface Setup {
  id: string;
  name: string;
}

export interface Trade {
  id: string;
  symbol: string;
  direction: Direction;
  size: number;
  entryPrice: number;
  exitPrice: number;
  /** P&L in USD — auto-calculable from entry/exit/size, but always editable
   * (contract size/pip value vary by instrument, so the auto-calc is a
   * convenience default, not a guaranteed-correct figure). */
  result: number;
  entryAt: string; // ISO datetime
  /** ISO datetime the trade closed — optional, since neither the manual
   * form nor the bulk-import format required it before duration tracking
   * was added. Trades without it just don't count toward avg duration. */
  exitAt?: string;
  setupId?: string;
  macroBias?: string;
  conviction?: string;
  newsEvent?: string;
  feeling?: string;
  notes?: string;
  source: TradeSource;
  createdAt: string;
}

export type NewTrade = Omit<Trade, "id" | "createdAt">;

/** Naive P&L convenience default: (exit - entry) * size, signed by direction.
 * Correct for instruments where price-move × size is already $ P&L 1:1;
 * for anything with a different contract multiplier (lots, futures, etc.)
 * this is a starting point to edit, not the final number. */
export function naiveResult(direction: Direction, entryPrice: number, exitPrice: number, size: number): number {
  const diff = exitPrice - entryPrice;
  const signed = direction === "buy" ? diff : -diff;
  return signed * size;
}

export const MACRO_BIAS_OPTIONS = ["Risk-On", "Risk-Off", "Neutre", "USD Fort", "USD Faible"];
export const CONVICTION_OPTIONS = ["Faible", "Moyenne", "Forte"];

// ────────────────────────────────────────────────────────────
// MT4/5-style bulk-paste import parser
// ────────────────────────────────────────────────────────────
// Format: "SYMBOL direction size / entry → exit  result / YYYY.MM.DD HH:mm:ss"
// e.g. "XAUUSD buy 0.3 / 4390.64 → 4388.52  -54.93 / 2026.08.14 17:01:56"
// One line per trade, `/`-delimited into 3 segments. Deliberately line-by-
// line and non-throwing — a bad line is reported, not fatal to the batch.
// ────────────────────────────────────────────────────────────
const ARROW_RE = /→|->/;
const DATETIME_RE = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/;

export interface ImportError { line: string; reason: string; }
export interface ImportResult { trades: NewTrade[]; errors: ImportError[]; }

function parseLine(raw: string): { trade?: NewTrade; error?: string } {
  const line = raw.trim();
  if (!line) return {};

  const parts = line.split("/").map((p) => p.trim());
  if (parts.length !== 3) return { error: `expected 3 "/"-separated segments, found ${parts.length}` };
  const [head, mid, tail] = parts;

  const headTokens = head.split(/\s+/).filter(Boolean);
  if (headTokens.length < 3) return { error: `could not read "symbol direction size" from "${head}"` };
  const [symbol, dirRaw, sizeRaw] = headTokens;
  const direction = dirRaw.toLowerCase() as Direction;
  if (direction !== "buy" && direction !== "sell") return { error: `unknown direction "${dirRaw}" (expected buy/sell)` };
  const size = Number(sizeRaw);
  if (!Number.isFinite(size)) return { error: `could not parse size "${sizeRaw}"` };

  const midParts = mid.split(ARROW_RE).map((p) => p.trim());
  if (midParts.length !== 2) return { error: `could not find "entry → exit" in "${mid}"` };
  const entryPrice = Number(midParts[0]);
  const exitTokens = midParts[1].split(/\s+/).filter(Boolean);
  const exitPrice = Number(exitTokens[0]);
  const result = Number((exitTokens[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(result)) {
    return { error: `could not parse entry/exit/result numbers from "${mid}"` };
  }

  const m = tail.match(DATETIME_RE);
  if (!m) return { error: `could not parse date "${tail}" (expected YYYY.MM.DD HH:mm:ss)` };
  const [, y, mo, d, h, mi, s] = m;
  const entryAt = `${y}-${mo}-${d}T${h}:${mi}:${s}`;

  return {
    trade: {
      symbol: symbol.toUpperCase(), direction, size, entryPrice, exitPrice, result, entryAt,
      source: "import",
    },
  };
}

export function parseImportText(text: string): ImportResult {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const trades: NewTrade[] = [];
  const errors: ImportError[] = [];
  for (const line of lines) {
    const { trade, error } = parseLine(line);
    if (trade) trades.push(trade);
    else if (error) errors.push({ line, reason: error });
  }
  return { trades, errors };
}

// ────────────────────────────────────────────────────────────
// Stats — computed from whatever trade list is passed in (caller filters
// by setup/symbol/date range first), so this stays a pure function of its
// input, not tied to the store.
// ────────────────────────────────────────────────────────────
export interface DirectionStats { count: number; winRate: number; net: number; }
export interface WeekdayStats { day: string; count: number; winRate: number; net: number; }
export interface EquityPoint { date: string; equity: number; }
export interface PeriodStats { label: string; net: number; count: number; }

export interface JournalStats {
  count: number;
  winRate: number;
  profitFactor?: number;
  maxDrawdown: number;
  /** Sharpe over the per-trade P&L series — not annualized (heterogeneous
   * symbols/sizes make a trading-day frequency assumption meaningless here). */
  sharpe?: number;
  recoveryFactor?: number;
  expectancy: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  avgWin: number;
  avgLoss: number;
  longestWinStreak: number;
  longestLossStreak: number;
  /** How far below the running equity peak the log sits right now — not
   * the historical worst (that's maxDrawdown), the current one. */
  currentDrawdown: number;
  byPeriod: PeriodStats[];
  /** "week" when the trade span is short enough that weekly buckets are more
   * legible than monthly ones (see computeByPeriod), else "month". */
  periodGranularity: "week" | "month";
  bestTrade?: Trade;
  worstTrade?: Trade;
  byDirection: Record<Direction, DirectionStats>;
  byWeekday: WeekdayStats[];
  equityCurve: EquityPoint[];

  // ── Capital-relative (all derived from the `baseCapital` passed into
  // computeStats — shown alongside the $ figures above, never replacing them) ──
  baseCapital: number;
  returnPct: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Return% / max-drawdown% — algebraically this equals recoveryFactor
   * whenever both are derived from the same undivided $ figures (the
   * baseCapital cancels out), since neither is annualized here. Kept as
   * its own field because the two ratios are conceptually distinct even
   * though they coincide numerically in this non-annualized form. */
  calmar?: number;
  /** Average notional (size × entry price) as % of capital — a naive proxy,
   * same convention as `naiveResult`: no per-instrument contract multiplier
   * (lot size, pip value, etc.), since that varies by instrument and isn't
   * tracked here. Undefined when nothing in view has finite size/entry data. */
  riskPerTradePct?: number;
  /** Same figure as `riskPerTradePct`, shown under its own label to match
   * the "Deposit Load" stat from the reference terminal: average position
   * notional as a % of account balance, i.e. how much of the account is
   * typically deployed per trade. Kept as a separate named field (not a
   * plain alias) so the two can diverge later if a margin/leverage-based
   * definition turns out to be wanted instead. */
  depositLoadPct?: number;
  /** Average entry-to-exit time across trades that have both timestamps —
   * trades missing `exitAt` are excluded, not treated as zero duration. */
  avgDurationMs?: number;
  /** Trade count normalized to a 7-day rate over the entryAt span of the
   * trades in view (not the calendar span of any filter) — a single-day
   * span is floored at 1 day so one busy day doesn't read as an
   * extrapolated triple-digit weekly rate. */
  tradesPerWeek: number;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function weekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const start = `${MONTH_ABBR[monday.getMonth()]} ${monday.getDate()}`;
  const end = monday.getMonth() === sunday.getMonth() ? `${sunday.getDate()}` : `${MONTH_ABBR[sunday.getMonth()]} ${sunday.getDate()}`;
  return `${start}–${end}`;
}

/** Weekly buckets while the log spans <= 60 days (monthly buckets would be
 * mostly-empty or a single bar), monthly once there's enough history for
 * monthly grouping to actually be more legible than weekly. */
function computeByPeriod(sorted: Trade[]): { periods: PeriodStats[]; granularity: "week" | "month" } {
  if (sorted.length === 0) return { periods: [], granularity: "week" };
  const times = sorted.map((t) => new Date(t.entryAt).getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  const useWeekly = spanDays <= 60;

  const groups = new Map<string, { label: string; net: number; count: number; sortKey: number }>();
  for (const t of sorted) {
    const d = new Date(t.entryAt);
    let key: string, label: string, sortKey: number;
    if (useWeekly) {
      const monday = isoWeekStart(d);
      key = monday.toISOString().slice(0, 10);
      label = weekLabel(monday);
      sortKey = monday.getTime();
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
      sortKey = d.getFullYear() * 12 + d.getMonth();
    }
    const g = groups.get(key) ?? { label, net: 0, count: 0, sortKey };
    g.net += t.result;
    g.count += 1;
    groups.set(key, g);
  }
  const periods = Array.from(groups.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ label, net, count }) => ({ label, net, count }));
  return { periods, granularity: useWeekly ? "week" : "month" };
}

function computeStreaks(sorted: Trade[]): { longestWin: number; longestLoss: number } {
  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  for (const t of sorted) {
    if (t.result > 0) { curWin += 1; curLoss = 0; }
    else if (t.result < 0) { curLoss += 1; curWin = 0; }
    else { curWin = 0; curLoss = 0; }
    maxWin = Math.max(maxWin, curWin);
    maxLoss = Math.max(maxLoss, curLoss);
  }
  return { longestWin: maxWin, longestLoss: maxLoss };
}

export function computeStats(trades: Trade[], baseCapital: number): JournalStats {
  const sorted = [...trades].sort((a, b) => (a.entryAt < b.entryAt ? -1 : 1));
  const results = sorted.map((t) => t.result);

  const wins = sorted.filter((t) => t.result > 0);
  const losses = sorted.filter((t) => t.result < 0);
  const grossProfit = wins.reduce((s, t) => s + t.result, 0);
  const grossLoss = losses.reduce((s, t) => s + t.result, 0);
  const netProfit = grossProfit + grossLoss;
  const winRate = sorted.length ? (wins.length / sorted.length) * 100 : 0;
  const profitFactor = grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : undefined;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const lossRate = sorted.length ? losses.length / sorted.length : 0;
  const expectancy = (winRate / 100) * avgWin + lossRate * avgLoss;

  let equity = 0, peak = 0, maxDD = 0;
  const equityCurve: EquityPoint[] = [];
  for (const t of sorted) {
    equity += t.result;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
    equityCurve.push({ date: t.entryAt, equity });
  }
  const recoveryFactor = maxDD !== 0 ? netProfit / maxDD : undefined;

  const mean = results.length ? results.reduce((s, v) => s + v, 0) / results.length : 0;
  const variance = results.length ? results.reduce((s, v) => s + (v - mean) ** 2, 0) / results.length : 0;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev !== 0 ? mean / stdev : undefined;

  const bestTrade = sorted.reduce<Trade | undefined>((best, t) => (!best || t.result > best.result ? t : best), undefined);
  const worstTrade = sorted.reduce<Trade | undefined>((worst, t) => (!worst || t.result < worst.result ? t : worst), undefined);

  const byDirection = (["buy", "sell"] as const).reduce((acc, dir) => {
    const subset = sorted.filter((t) => t.direction === dir);
    const w = subset.filter((t) => t.result > 0).length;
    acc[dir] = { count: subset.length, winRate: subset.length ? (w / subset.length) * 100 : 0, net: subset.reduce((s, t) => s + t.result, 0) };
    return acc;
  }, {} as Record<Direction, DirectionStats>);

  const byWeekday: WeekdayStats[] = WEEKDAY_LABELS.map((day, i) => {
    const subset = sorted.filter((t) => new Date(t.entryAt).getDay() === i);
    const w = subset.filter((t) => t.result > 0).length;
    return { day, count: subset.length, winRate: subset.length ? (w / subset.length) * 100 : 0, net: subset.reduce((s, t) => s + t.result, 0) };
  });

  const { longestWin, longestLoss } = computeStreaks(sorted);
  const { periods: byPeriod, granularity: periodGranularity } = computeByPeriod(sorted);

  // Current drawdown: distance below the running peak at the *last* trade,
  // as opposed to maxDrawdown's historical worst point.
  const currentDrawdown = peak - equity;

  const hasCapital = baseCapital > 0;
  const returnPct = hasCapital ? (netProfit / baseCapital) * 100 : 0;
  const maxDrawdownPct = hasCapital ? (maxDD / baseCapital) * 100 : 0;
  const currentDrawdownPct = hasCapital ? (currentDrawdown / baseCapital) * 100 : 0;
  const avgWinPct = hasCapital ? (avgWin / baseCapital) * 100 : 0;
  const avgLossPct = hasCapital ? (avgLoss / baseCapital) * 100 : 0;
  const calmar = maxDrawdownPct !== 0 ? returnPct / maxDrawdownPct : undefined;

  const notionals = sorted
    .map((t) => t.size * t.entryPrice)
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgNotional = notionals.length ? notionals.reduce((s, v) => s + v, 0) / notionals.length : undefined;
  const riskPerTradePct = hasCapital && avgNotional != null ? (avgNotional / baseCapital) * 100 : undefined;
  const depositLoadPct = riskPerTradePct;

  const durationsMs = sorted
    .filter((t): t is Trade & { exitAt: string } => !!t.exitAt)
    .map((t) => new Date(t.exitAt).getTime() - new Date(t.entryAt).getTime())
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  const avgDurationMs = durationsMs.length
    ? durationsMs.reduce((s, v) => s + v, 0) / durationsMs.length
    : undefined;

  let tradesPerWeek = 0;
  if (sorted.length > 0) {
    const times = sorted.map((t) => new Date(t.entryAt).getTime());
    const spanDays = Math.max(1, (Math.max(...times) - Math.min(...times)) / 86_400_000);
    tradesPerWeek = sorted.length / (spanDays / 7);
  }

  return {
    count: sorted.length, winRate, profitFactor, maxDrawdown: maxDD, sharpe, recoveryFactor,
    expectancy, grossProfit, grossLoss, netProfit, avgWin, avgLoss,
    longestWinStreak: longestWin, longestLossStreak: longestLoss, currentDrawdown,
    byPeriod, periodGranularity, bestTrade, worstTrade, byDirection, byWeekday, equityCurve,
    baseCapital, returnPct, maxDrawdownPct, currentDrawdownPct, avgWinPct, avgLossPct, calmar,
    riskPerTradePct, depositLoadPct, avgDurationMs, tradesPerWeek,
  };
}

/** Renders a masked placeholder instead of `display` when `hidden` is true —
 * the single choke point every $ figure in Track Record routes through, so
 * "does this leak a dollar amount when prices are hidden" has one place to
 * check instead of N. */
export function mask(display: string, hidden: boolean): string {
  return hidden ? "••••••" : display;
}
