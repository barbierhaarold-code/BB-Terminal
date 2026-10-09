import { CURRENCIES, LOOKBACKS, PAIRS, STALE_PAIR_DAYS, WINDOW_1Y_DAYS, WINDOW_5Y_DAYS, WINDOW_START_TOLERANCE_DAYS, type Ccy, type Lookback } from "./config";
import type { Bar, Change, StrengthBoard, StrengthResult, VolReading } from "./types";

// Pure maths for GAUGES. No I/O, no clock reads. Missing or invalid data is left out and said so, never filled.

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Ascending, one bar per date (last one wins), finite positive closes only. */
export function cleanBars(bars: Bar[]): Bar[] {
  const by = new Map<string, number>();
  for (const b of bars) if (/^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.close) && b.close > 0) by.set(b.date, b.close);
  return [...by].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Percent of `window` values that are ≤ x (x itself is part of the window), 0–100. Null for an empty window. */
export function percentileRank(window: number[], x: number): number | null {
  if (window.length === 0) return null;
  let le = 0;
  for (const v of window) if (v <= x) le++;
  return (le / window.length) * 100;
}

/** Closes in the trailing `days` calendar days up to and including the last bar, plus whether the history reaches back far enough. */
export function trailingWindow(bars: Bar[], days: number): { closes: number[]; covered: boolean; start: string } {
  const last = bars[bars.length - 1];
  const startMs = ms(last.date) - days * DAY;
  const closes = bars.filter((b) => ms(b.date) > startMs).map((b) => b.close);
  const first = bars[0];
  return { closes, covered: ms(first.date) <= startMs + WINDOW_START_TOLERANCE_DAYS * DAY, start: iso(startMs) };
}

/** Change of the latest close versus the close n bars earlier (the series' own trading days). */
export function changeOver(bars: Bar[], n: number): Change | null {
  if (bars.length <= n) return null;
  const last = bars[bars.length - 1], prev = bars[bars.length - 1 - n];
  return { points: last.close - prev.close, pct: prev.close !== 0 ? (last.close / prev.close - 1) * 100 : null, from: prev.date };
}

export function volReading(def: { id: string; label: string; measures: string }, raw: Bar[]): VolReading | { error: string } {
  const bars = cleanBars(raw);
  if (bars.length === 0) return { error: "No usable daily closes were returned." };
  const last = bars[bars.length - 1];
  const warnings: string[] = [];
  const w1 = trailingWindow(bars, WINDOW_1Y_DAYS), w5 = trailingWindow(bars, WINDOW_5Y_DAYS);
  if (!w1.covered) warnings.push(`History starts ${bars[0].date}, after the 1-year window start ${w1.start}: 1-year percentile not shown.`);
  if (!w5.covered) warnings.push(`History starts ${bars[0].date}, after the 5-year window start ${w5.start}: 5-year percentile not shown.`);
  return {
    id: def.id, label: def.label, measures: def.measures, level: last.close, asOf: last.date,
    change1d: changeOver(bars, 1), change5d: changeOver(bars, 5),
    pctile1y: w1.covered ? percentileRank(w1.closes, last.close) : null,
    pctile5y: w5.covered ? percentileRank(w5.closes, last.close) : null,
    n1y: w1.closes.length, n5y: w5.closes.length, warnings,
  };
}

// ───────────── currency strength ─────────────

/** Move of each currency against USD over the window, from the pair's log return (USD itself is 0). */
export function movesVsUsd(returnsByPair: Record<string, number | null>): Record<Ccy, number | null> {
  const x = Object.fromEntries(CURRENCIES.map((c) => [c, null])) as Record<Ccy, number | null>;
  x.USD = 0;
  for (const p of PAIRS) {
    const r = returnsByPair[p.id];
    if (r == null || !Number.isFinite(r)) continue;
    if (p.quote === "USD") x[p.base] = r;     // EURUSD up = EUR up vs USD
    else x[p.quote] = -r;                     // USDJPY up = JPY down vs USD
  }
  return x;
}

/** Strength(c) = mean over the other currencies d with a known move of x(c) − x(d), in percent. Null if c's own move is unknown or no other currency is known. */
export function strengthFromMoves(x: Record<Ccy, number | null>): Record<Ccy, number | null> {
  const out = {} as Record<Ccy, number | null>;
  for (const c of CURRENCIES) {
    const xc = x[c];
    if (xc == null) { out[c] = null; continue; }
    const others = CURRENCIES.filter((d) => d !== c && x[d] != null);
    out[c] = others.length ? (others.reduce((a, d) => a + (xc - (x[d] as number)), 0) / others.length) * 100 : null;
  }
  return out;
}

/** Strength board from raw pair series. Stale or empty pairs are left out (and listed); windows run between common trading dates of the pairs used. */
export function strengthBoard(series: Record<string, Bar[]>): StrengthBoard {
  const cleaned: Record<string, Bar[]> = {};
  const leftOut: StrengthBoard["pairsLeftOut"] = [];
  for (const p of PAIRS) {
    const b = cleanBars(series[p.id] ?? []);
    if (b.length === 0) leftOut.push({ id: p.id, why: "no usable daily closes" });
    else cleaned[p.id] = b;
  }
  const newest = Object.values(cleaned).reduce<string | null>((m, b) => { const d = b[b.length - 1].date; return !m || d > m ? d : m; }, null);
  if (newest) for (const id of Object.keys(cleaned)) {
    const d = cleaned[id][cleaned[id].length - 1].date;
    if ((ms(newest) - ms(d)) / DAY > STALE_PAIR_DAYS) { leftOut.push({ id, why: `latest close ${d} is older than the newest pair's ${newest}` }); delete cleaned[id]; }
  }
  const ids = Object.keys(cleaned);
  const empty = (lb: Lookback): StrengthResult => ({ lookback: lb, rows: CURRENCIES.map((currency) => ({ currency, value: null, rank: null })), from: null, to: null });
  if (ids.length === 0) return { results: LOOKBACKS.map(empty), pairsUsed: [], pairsLeftOut: leftOut, asOf: null, commonDates: 0 };

  let dates: string[] | null = null;
  for (const id of ids) { const s = new Set(cleaned[id].map((b) => b.date)); dates = dates ? dates.filter((d) => s.has(d)) : [...s]; }
  dates = (dates ?? []).sort();
  const closeOn = (id: string) => new Map(cleaned[id].map((b) => [b.date, b.close]));
  const maps = Object.fromEntries(ids.map((id) => [id, closeOn(id)]));

  const results = LOOKBACKS.map((lb): StrengthResult => {
    if (dates!.length <= lb) return empty(lb);
    const to = dates![dates!.length - 1], from = dates![dates!.length - 1 - lb];
    const rets: Record<string, number | null> = {};
    for (const p of PAIRS) rets[p.id] = ids.includes(p.id) ? Math.log(maps[p.id].get(to)! / maps[p.id].get(from)!) : null;
    const s = strengthFromMoves(movesVsUsd(rets));
    const ranked = CURRENCIES.filter((c) => s[c] != null).sort((a, b) => (s[b] as number) - (s[a] as number) || a.localeCompare(b));
    return { lookback: lb, from, to, rows: CURRENCIES.map((currency) => ({ currency, value: s[currency], rank: s[currency] == null ? null : ranked.indexOf(currency) + 1 })) };
  });
  return { results, pairsUsed: ids, pairsLeftOut: leftOut, asOf: dates.length ? dates[dates.length - 1] : null, commonDates: dates.length };
}

/** The newest daily bar dated today (UTC) is usually the session still in progress, not a final close. */
export const maybeIntraday = (asOf: string, nowMs: number) => asOf >= new Date(nowMs).toISOString().slice(0, 10);

export const fmtNum = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "n/a" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtSigned = (v: number | null | undefined, d = 2) => {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const r = Math.round(Math.abs(v) * 10 ** d) / 10 ** d;
  return `${r === 0 ? "" : v > 0 ? "+" : "−"}${r.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
