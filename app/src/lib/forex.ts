import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchIntraday, fetchSpotQuote, type Candle } from "@/lib/api";

// ────────────────────────────────────────────────────────────
// Instruments
// ────────────────────────────────────────────────────────────
export type FxKind = "metal" | "major" | "cross" | "index" | "spot";

export interface Instrument {
  /** Stable key, also the display pair e.g. "EUR/USD" */
  pair: string;
  /** Yahoo symbol used by the batched equity quote + historical endpoints */
  symbol: string;
  kind: FxKind;
  /** decimals for the last price */
  digits: number;
}

// Gold now prices off real spot XAU/USD (Twelve Data, see api.ts) — the
// scalper and ticker tape fetch it separately (fetchSpotQuote), not through
// this GC=F/yfinance entry. GC=F stays here only as the symbol identity
// used by search/GP routing (GP's TradingView mapping already resolves
// GC=F → OANDA:XAUUSD spot, so the chart and the numeric feeds now agree).
// Silver has no free spot ticker anywhere in this pipeline — yfinance has
// no working XAG=X, and Twelve Data 404s XAG/USD on the free tier ("Grow or
// Venture plan" required) — so SI=F COMEX futures (basis premium vs spot)
// remains silver's only source, and stays labeled as such.
export const METALS: Instrument[] = [
  { pair: "GOLD", symbol: "GC=F", kind: "metal", digits: 2 },
  { pair: "SILVER (FUT)", symbol: "SI=F", kind: "metal", digits: 3 },
];

export const MAJORS: Instrument[] = [
  { pair: "EUR/USD", symbol: "EURUSD=X", kind: "major", digits: 5 },
  { pair: "GBP/USD", symbol: "GBPUSD=X", kind: "major", digits: 5 },
  { pair: "USD/JPY", symbol: "USDJPY=X", kind: "major", digits: 3 },
  { pair: "USD/CHF", symbol: "USDCHF=X", kind: "major", digits: 5 },
  { pair: "AUD/USD", symbol: "AUDUSD=X", kind: "major", digits: 5 },
  { pair: "USD/CAD", symbol: "USDCAD=X", kind: "major", digits: 5 },
  { pair: "NZD/USD", symbol: "NZDUSD=X", kind: "major", digits: 5 },
];

export const CROSSES: Instrument[] = [
  { pair: "EUR/GBP", symbol: "EURGBP=X", kind: "cross", digits: 5 },
  { pair: "EUR/JPY", symbol: "EURJPY=X", kind: "cross", digits: 3 },
  { pair: "GBP/JPY", symbol: "GBPJPY=X", kind: "cross", digits: 3 },
  { pair: "EUR/CHF", symbol: "EURCHF=X", kind: "cross", digits: 5 },
  { pair: "AUD/JPY", symbol: "AUDJPY=X", kind: "cross", digits: 3 },
  { pair: "CHF/JPY", symbol: "CHFJPY=X", kind: "cross", digits: 3 },
  { pair: "EUR/AUD", symbol: "EURAUD=X", kind: "cross", digits: 5 },
];

// US Dollar Index. Tried both `DX=F` (ICE dollar index future) and
// `DX-Y.NYB` on Yahoo through this provider — DX=F returns nothing (empty
// body, invalid symbol for yfinance), DX-Y.NYB returns clean, continuously
// live 5m data. Routes through the equity endpoint like the metals (not
// `kind: "metal"` itself since it isn't one, but same routing/tz bucket).
export const DXY: Instrument = { pair: "DXY", symbol: "DX-Y.NYB", kind: "index", digits: 3 };

/** Everything shown on the FXC board, in render order. */
export const FX_BOARD: Instrument[] = [...METALS, DXY, ...MAJORS, ...CROSSES];

/** Symbols cycled by the footer ticker tape via the shared yfinance intraday
 * pipeline (FX + silver + a couple index futures). Gold is NOT here — it's
 * sourced separately from the Twelve Data spot feed and merged in by
 * TickerTape itself, same reason as the METALS comment above. */
export const TICKER_INSTRUMENTS: Instrument[] = [
  METALS[1], // silver only
  ...MAJORS,
  { pair: "EUR/JPY", symbol: "EURJPY=X", kind: "cross", digits: 3 },
  { pair: "GBP/JPY", symbol: "GBPJPY=X", kind: "cross", digits: 3 },
];

/** Index futures for the ticker tape (quoted via the equity endpoint). */
export const TICKER_FUTURES = [
  { pair: "ES (S&P)", symbol: "ES=F", digits: 2 },
  { pair: "NQ (Nasdaq)", symbol: "NQ=F", digits: 2 },
];

/** Gold futures (GC=F) — the instrument the scalper tracks. */
export const GOLD_FUT: Instrument = METALS[0];

// ────────────────────────────────────────────────────────────
// Staleness — surfaces frozen/cached upstream data instead of silently
// showing an old price as if it were live.
//
// Thresholds are per-kind, not one blanket number. Verified directly against
// the backend by polling GC=F/SI=F/DX-Y.NYB (equity-endpoint-routed) and
// EURUSD=X (currency-endpoint-routed) a minute apart: FX pairs report a new
// candle within ~1 minute of real time, but metals/DXY carry a structural
// ~10-15 minute reporting lag on this feed (the standard delayed-quote
// behavior yfinance's free tier gives futures/equities, vs FX's near-live
// spot pricing — not a fault, not a freeze). A flat 10-minute threshold
// would flag gold/silver/DXY as "stale" on every normal poll; 20 minutes
// still catches a genuine multi-bar gap without crying wolf on ordinary lag.
// ────────────────────────────────────────────────────────────
const STALE_AFTER_MS: Record<FxKind, number> = {
  major: 10 * 60_000,
  cross: 10 * 60_000,
  metal: 20 * 60_000,
  index: 20 * 60_000,
  // Twelve Data's spot quote timestamp (`last_quote_at`) is a real Unix
  // epoch, not a naive exchange-local string — verified against it directly,
  // it trails real time by well under a minute in normal operation. A much
  // tighter threshold than the yfinance metals bucket is appropriate here.
  spot: 3 * 60_000,
};

/** Age of the most recent candle in ms, or undefined if there's no data yet. */
export function dataAgeMs(asOf?: string): number | undefined {
  if (!asOf) return undefined;
  const t = new Date(asOf).getTime();
  return Number.isFinite(t) ? Date.now() - t : undefined;
}

export function isStale(asOf: string | undefined, kind: FxKind = "major"): boolean {
  const age = dataAgeMs(asOf);
  return age != null && age > STALE_AFTER_MS[kind];
}

/** "12m" / "3h" — compact age label for a staleness badge. */
export function fmtAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

/**
 * When a card's data crosses the staleness threshold, force one refetch that
 * bypasses the proxy cache instead of just flashing a badge and giving up.
 * Fires once per distinct stale `asOf` (not on every render/poll), so a
 * genuinely dead upstream feed doesn't get hammered — if the retry still
 * comes back on the same stale candle, that's real signal the feed itself
 * has gapped, not a caching artifact.
 */
export function useStaleBust(symbol: string, kind: FxKind, asOf: string | undefined, stale: boolean) {
  const queryClient = useQueryClient();
  const triedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!stale || !asOf || triedFor.current === asOf) return;
    triedFor.current = asOf;
    queryClient.fetchQuery({
      queryKey: ["fx-intra", symbol],
      queryFn: () => fetchIntraday(symbol, {
        interval: INTRADAY.interval,
        days: INTRADAY.days,
        kind: kind === "metal" || kind === "index" ? "metal" : "fx",
        bust: true,
      }),
    });
  }, [stale, asOf, symbol, kind, queryClient]);
}

// ────────────────────────────────────────────────────────────
// Price helpers
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// Intraday-derived prices — the single source of truth for the board
// ────────────────────────────────────────────────────────────
// The FX/metals *quote* endpoint returns no real `last_price` for these asset
// types (only bid/ask/open/high/low), so a mid/prev_close fallback there is
// always an approximation and can drift outside the reported day range. Instead
// we derive every figure from one intraday candle series: `last` is the final
// candle's close and high/low are computed over that same series, so `last` is
// structurally guaranteed to sit within [low, high] on every refresh.

/** Shared intraday fetch parameters — identical everywhere so React Query
 * dedupes to one request per symbol across the board, tape, and scalper. */
export const INTRADAY = { interval: "5m", days: 3, refetchMs: 20_000 } as const;

/** Query options for one instrument's intraday series (stable key = shared cache). */
export function intradayQueryOptions(inst: { symbol: string; kind: FxKind }) {
  return {
    queryKey: ["fx-intra", inst.symbol] as const,
    queryFn: () => fetchIntraday(inst.symbol, {
      interval: INTRADAY.interval,
      days: INTRADAY.days,
      kind: inst.kind === "metal" || inst.kind === "index" ? "metal" as const : "fx" as const,
    }),
    refetchInterval: INTRADAY.refetchMs,
    staleTime: INTRADAY.refetchMs - 2_000,
  };
}

/** Query options for the Twelve Data spot quote (shared cache — scalper and
 * tape both subscribe to the same ["spot-quote", symbol] key, so it's one
 * poll regardless of how many components render it). */
export function spotQueryOptions(symbol: string) {
  return {
    queryKey: ["spot-quote", symbol] as const,
    queryFn: () => fetchSpotQuote(symbol),
    refetchInterval: 20_000,
    staleTime: 18_000,
  };
}

export interface IntradayStats {
  last?: number;
  high?: number;
  low?: number;
  open?: number;
  prevClose?: number;
  /** ISO timestamp of the last candle */
  asOf?: string;
  /** candle count in the current session day (for degenerate-range guards) */
  todayCount: number;
}

/**
 * Derive last / day high / day low / open / prev-close from a single intraday
 * candle series. "Day" is the calendar day of the last candle *in that series'
 * own timestamps* (UTC for FX, exchange-time for futures) — grouping by the same
 * field the series uses keeps `last` provably inside [low, high].
 */
export function intradayStats(candles?: Candle[]): IntradayStats {
  if (!candles || candles.length === 0) return { todayCount: 0 };
  const lastC = candles[candles.length - 1];
  const dayKey = lastC.date.slice(0, 10);
  const today = candles.filter((c) => c.date.slice(0, 10) === dayKey);
  let prevClose: number | undefined;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].date.slice(0, 10) !== dayKey) { prevClose = candles[i].close; break; }
  }
  return {
    last: lastC.close,
    high: today.length ? Math.max(...today.map((c) => c.high)) : undefined,
    low: today.length ? Math.min(...today.map((c) => c.low)) : undefined,
    open: today[0]?.open,
    prevClose,
    asOf: lastC.date,
    todayCount: today.length,
  };
}

/** Last N closes for a sparkline (falls back to the whole series if short). */
export function sparkCloses(candles: Candle[] | undefined, n = 60): number[] {
  if (!candles?.length) return [];
  return candles.slice(-n).map((c) => c.close);
}

/** 14-period ATR from OHLC candles. Returns undefined if not enough data. */
export function atr(candles: Candle[], period = 14): number | undefined {
  if (!candles || candles.length < period + 1) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trs.push(tr);
  }
  // Wilder's smoothing
  let a = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
  }
  return a;
}

// ────────────────────────────────────────────────────────────
// Forex sessions — pure timezone math (DST-aware via IANA zones)
// ────────────────────────────────────────────────────────────
export interface SessionDef {
  name: string;
  short: string;
  tz: string;
  /** local open/close hour (24h) at the financial center */
  open: number;
  close: number;
}

export const SESSIONS: SessionDef[] = [
  { name: "Sydney", short: "SYD", tz: "Australia/Sydney", open: 7, close: 16 },
  { name: "Tokyo", short: "TYO", tz: "Asia/Tokyo", open: 9, close: 18 },
  { name: "London", short: "LDN", tz: "Europe/London", open: 8, close: 17 },
  { name: "New York", short: "NY", tz: "America/New_York", open: 8, close: 17 },
];

/** Minutes to add to a UTC instant to get wall-clock time in `tz`. */
function zoneOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) m[p.type] = p.value;
  const h = m.hour === "24" ? 0 : +m.hour; // some engines emit 24 for midnight
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, h, +m.minute, +m.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** Wall-clock parts (day-of-week + minutes-since-midnight) in a zone. */
export function localParts(tz: string, at: Date): { dow: number; minutes: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) m[p.type] = p.value;
  const h = m.hour === "24" ? 0 : +m.hour;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[m.weekday] ?? 0, minutes: h * 60 + +m.minute };
}

export interface SessionStatus {
  def: SessionDef;
  open: boolean;
  /** ms until the next transition (open→close or close→open) */
  msToNext: number;
  /** localized "HH:MM" current time at the center */
  localTime: string;
  /** true when this session is dark for the weekend */
  weekend: boolean;
}

/**
 * Compute UTC epoch for a given local wall-clock time (today or +dayOffset) in tz.
 * Uses the zone offset at `ref`; near a DST switch this can be ~1h off, which is
 * fine for a countdown clock.
 */
export function localToUtc(tz: string, ref: Date, dayOffset: number, hour: number, minute = 0): number {
  const off = zoneOffsetMinutes(tz, ref);
  // Build the local calendar date (in tz) then shift by dayOffset days.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(ref)) m[p.type] = p.value;
  const base = Date.UTC(+m.year, +m.month - 1, +m.day + dayOffset, hour, minute);
  return base - off * 60000;
}

export function sessionStatus(def: SessionDef, now: Date): SessionStatus {
  const { dow, minutes } = localParts(def.tz, now);
  const openMin = def.open * 60;
  const closeMin = def.close * 60;
  const withinHours = minutes >= openMin && minutes < closeMin;
  const isWeekday = dow >= 1 && dow <= 5;
  const open = withinHours && isWeekday;

  const localTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  let msToNext: number;
  if (open) {
    msToNext = localToUtc(def.tz, now, 0, def.close, 0) - now.getTime();
  } else {
    // find the next weekday open (today if still ahead, else scan forward)
    let msNext = Infinity;
    for (let d = 0; d <= 4; d++) {
      const openUtc = localToUtc(def.tz, now, d, def.open, 0);
      if (openUtc <= now.getTime()) continue;
      // day-of-week of that target
      const targetDow = (dow + d) % 7;
      if (targetDow >= 1 && targetDow <= 5) { msNext = openUtc - now.getTime(); break; }
    }
    msToNext = msNext;
  }

  return { def, open, msToNext, localTime, weekend: !isWeekday };
}

export interface Overlap {
  label: string;
  a: string;
  b: string;
  active: boolean;
}

/** The two liquidity-overlap windows worth flagging for scalping. */
export function overlaps(now: Date): Overlap[] {
  const byName: Record<string, boolean> = {};
  for (const s of SESSIONS) byName[s.name] = sessionStatus(s, now).open;
  return [
    { label: "London × New York", a: "London", b: "New York", active: byName["London"] && byName["New York"] },
    { label: "Tokyo × London", a: "Tokyo", b: "London", active: byName["Tokyo"] && byName["London"] },
  ];
}

/**
 * Session window as fractional UTC hours [0,24) for *today*, used to position
 * bands on a 24h timeline. Returns 1–2 segments (2 when it wraps past midnight).
 */
export function sessionUtcBands(def: SessionDef, now: Date): Array<[number, number]> {
  const openMs = localToUtc(def.tz, now, 0, def.open, 0);
  const closeMs = localToUtc(def.tz, now, 0, def.close, 0);
  const toHour = (ms: number) => (((ms % 86400000) + 86400000) % 86400000) / 3600000;
  const start = toHour(openMs);
  const end = toHour(closeMs);
  if (end > start) return [[start, end]];
  // wrapped past 24:00 UTC
  return [[start, 24], [0, end]];
}

/** Current UTC hour as a fraction [0,24) — the "now" marker on the timeline. */
export function utcNowHour(now: Date): number {
  return (now.getUTCHours() * 60 + now.getUTCMinutes()) / 60;
}

/** Format ms as "Hh Mm" / "Mm Ss" for a countdown. */
export function fmtCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
