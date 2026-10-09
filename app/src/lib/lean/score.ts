import {
  BASE_WEIGHTS, DRIVER_LABELS, INSTRUMENT_BY_ID, LEAN_THRESHOLD, NEUTRAL_BAND, SERIES, WALK_FORWARD_MULT, effectiveWeight,
  type InstrumentDef, type Signed,
} from "./config";
import type {
  Bar, Component, CotReading, Direction, DriverId, DriverResult, Flip, LeanInputs, LeanLabel, LeanResult, SeriesKind,
} from "./types";

// ────────────────────────────────────────────────────────────
// Market Lean scoring engine. PURE and DETERMINISTIC: no I/O, no clock, no
// randomness. The same inputs always give the same output, and bars dated after
// `asOf` can never influence the result (own series: bars <= asOf; every other
// series: bars strictly before asOf, because daily bars of different markets
// close at different hours).
//
// Each driver yields a score in [-1, +1] (+1 = bullish for the instrument).
// Composite L = Σ w·s / Σ w over drivers with data.
// signAgreement = |Σ w·s| / Σ w·|s|      (1 = all weighted scores point the same way)
// Completeness= Σ w·c / Σ w over all weighted drivers (c = share of the driver's inputs present)
// Driver agreement = round(100 · signAgreement · Completeness) — the share of weighted drivers pointing the
// same way. It is NOT a probability of being right.
// ────────────────────────────────────────────────────────────

const TREND_SIGMA_WINDOW = 60;
const MIN_SIGMA_OBS = 40;

// ───────────── small maths ─────────────

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
export const sma = (closes: number[], n: number): number | null =>
  closes.length >= n ? mean(closes.slice(closes.length - n)) : null;
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
export const dirOf = (score: number | null): Direction =>
  score == null ? "n/a" : score >= NEUTRAL_BAND ? "bullish" : score <= -NEUTRAL_BAND ? "bearish" : "neutral";

/** Longest lookback any leg needs is 200 bars (SMA200); 260 leaves headroom and keeps long histories cheap. */
const MAX_WINDOW = 260;

/** Last <=260 bars up to `date`: inclusive for the instrument's own series, strictly before for every other series. */
export function sliceAsOf(bars: Bar[] | undefined, date: string, inclusive: boolean): Bar[] {
  if (!bars || bars.length === 0) return [];
  let lo = 0, hi = bars.length; // first index that is NOT allowed
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const ok = inclusive ? bars[mid].date <= date : bars[mid].date < date;
    if (ok) lo = mid + 1; else hi = mid;
  }
  return bars.slice(Math.max(0, lo - MAX_WINDOW), lo);
}

// ───────────── formatting for raw inputs ─────────────

const fmtN = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const fmtPct = (r: number, d = 2) => `${sgn(r)}${fmtN(Math.abs(r) * 100, d)}%`;
const px = (n: number) => fmtN(n, Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 10 ? 3 : 5);

// ───────────── trend of a single series ─────────────

export interface TrendInfo {
  lastDate: string;
  last: number;
  sma50: number | null;
  sma200: number | null;
  mom20: number | null;
  components: Component[];
  /** equal-weight mean of available component scores; null when none */
  score: number | null;
  completeness: number;
}

/**
 * Four volatility-normalised legs, each tanh(z) with z = move / (σ·√N), σ = stdev of the last 60 daily
 * log returns (price) or daily changes (yield). Legs: price vs SMA50 (N=25), price vs SMA200 (N=100),
 * SMA50 20-day slope (N=20), 20-day momentum (N=20). Yields use only SMA50 and 20-day change.
 */
export function trendOf(bars: Bar[], kind: SeriesKind, only?: string[]): TrendInfo | null {
  if (bars.length < MIN_SIGMA_OBS + 1) return null;
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const win = closes.slice(-(TREND_SIGMA_WINDOW + 1));
  const rets: number[] = [];
  for (let i = 1; i < win.length; i++) {
    rets.push(kind === "yield" ? win[i] - win[i - 1] : Math.log(win[i] / win[i - 1]));
  }
  const sigma = stdev(rets);
  if (!Number.isFinite(sigma) || sigma <= 0) return null;

  const isYield = kind === "yield";
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const s50Prev = closes.length >= 70 ? mean(closes.slice(closes.length - 70, closes.length - 20)) : null;
  const m20 = closes.length >= 21 ? closes[closes.length - 21] : null;

  const dist = (a: number, b: number) => (isYield ? a - b : a / b - 1);
  const show = (v: number) => (isYield ? `${sgn(v)}${fmtN(Math.abs(v) * 100, 0)} bp` : fmtPct(v));
  const lvl = (v: number) => (isYield ? `${fmtN(v, 3)}%` : px(v));

  const legs: { id: string; label: string; N: number; val: number | null; raw: (v: number) => string; need: string }[] = [
    { id: "sma50", label: "Price vs 50-day SMA", N: 25, val: s50 == null ? null : dist(last, s50), raw: (v) => `${show(v)} (SMA50 ${lvl(s50!)}, last ${lvl(last)})`, need: "needs 50 daily bars" },
    ...(isYield ? [] : [{ id: "sma200", label: "Price vs 200-day SMA", N: 100, val: s200 == null ? null : dist(last, s200), raw: (v: number) => `${show(v)} (SMA200 ${lvl(s200!)})`, need: "needs 200 daily bars" }]),
    ...(isYield ? [] : [{ id: "slope50", label: "50-day SMA slope (20d)", N: 20, val: s50 == null || s50Prev == null ? null : dist(s50, s50Prev), raw: (v: number) => `${show(v)} over 20 days`, need: "needs 70 daily bars" }]),
    { id: "mom20", label: "20-day momentum", N: 20, val: m20 == null ? null : dist(last, m20), raw: (v) => `${show(v)} over 20 days`, need: "needs 21 daily bars" },
  ];
  const chosen = only ? legs.filter((l) => only.includes(l.id)) : legs;
  const components: Component[] = chosen.map((l) => {
    if (l.val == null) return { id: l.id, label: l.label, raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: l.need };
    const score = Math.tanh(l.val / (sigma * Math.sqrt(l.N)));
    return { id: l.id, label: l.label, raw: l.raw(l.val), rawValue: l.val, score, direction: dirOf(score) };
  });
  const have = components.filter((c) => c.score != null);
  return {
    lastDate: bars[bars.length - 1].date, last, sma50: s50, sma200: s200,
    mom20: m20 == null ? null : dist(last, m20),
    components,
    score: have.length ? mean(have.map((c) => c.score!)) : null,
    completeness: components.length ? have.length / components.length : 0,
  };
}

// ───────────── driver builders ─────────────

interface Ctx {
  inst: InstrumentDef;
  inputs: LeanInputs;
  flips: { text: string; driver: DriverId }[];
  warnings: string[];
  lastBar: Record<string, string | null>;
}

function seriesFor(ctx: Ctx, id: string, own: boolean): { bars: Bar[]; missing?: string } {
  const bars = sliceAsOf(ctx.inputs.series[id], ctx.inputs.asOf, own);
  ctx.lastBar[id] = bars.length ? bars[bars.length - 1].date : null;
  if (bars.length === 0) {
    const err = ctx.inputs.seriesErrors?.[id];
    return { bars, missing: err ? `download failed: ${err}` : "no data returned" };
  }
  return { bars };
}

function makeDriver(id: DriverId, inst: InstrumentDef, components: Component[], extra: Partial<DriverResult> = {}): DriverResult {
  const scored = components.filter((c) => !c.infoOnly);
  const have = scored.filter((c) => c.score != null);
  const score = have.length ? mean(have.map((c) => c.score!)) : null;
  const weight = effectiveWeight(inst, id);
  return {
    id, label: DRIVER_LABELS[id], baseWeight: BASE_WEIGHTS[id], weight, multiplier: WALK_FORWARD_MULT[id], displayOnly: weight === 0,
    score, direction: dirOf(score), completeness: scored.length ? have.length / scored.length : 0,
    components, ...extra,
  };
}

function trendDriver(ctx: Ctx): DriverResult {
  const { inst } = ctx;
  const { bars, missing } = seriesFor(ctx, inst.series, true);
  const def = SERIES[inst.series];
  const t = bars.length ? trendOf(bars, def.kind) : null;
  if (!t) {
    const why = missing ?? "too few bars for a volatility estimate (needs 41+)";
    ctx.warnings.push(`Trend: ${def.label} ${why}.`);
    return makeDriver("trend", inst, ["sma50", "sma200", "slope50", "mom20"].map((id) => ({ id, label: id, raw: "n/a", rawValue: null, score: null, direction: "n/a" as const, missing: why })));
  }
  if (t.sma50 != null) ctx.flips.push({ driver: "trend", text: `Close ${t.last >= t.sma50 ? "below" : "above"} its 50-day SMA (${px(t.sma50)}) would flip the "price vs SMA50" leg ${t.last >= t.sma50 ? "bearish" : "bullish"} (last ${px(t.last)}).` });
  if (t.sma200 != null) ctx.flips.push({ driver: "trend", text: `Close ${t.last >= t.sma200 ? "below" : "above"} its 200-day SMA (${px(t.sma200)}) would flip the "price vs SMA200" leg ${t.last >= t.sma200 ? "bearish" : "bullish"}.` });
  return makeDriver("trend", inst, t.components);
}

function signedDriver(ctx: Ctx, id: "dollarRates" | "cross", defs: Signed[]): DriverResult {
  const comps: Component[] = defs.map((d) => {
    const sd = SERIES[d.series];
    const { bars, missing } = seriesFor(ctx, d.series, false);
    const t = bars.length ? trendOf(bars, sd.kind) : null;
    const label = `${sd.label}${d.sign < 0 ? " (inverted)" : ""}`;
    if (!t || t.score == null) {
      const why = missing ?? "too few bars";
      ctx.warnings.push(`${DRIVER_LABELS[id]}: ${sd.label} ${why}.`);
      return { id: d.series, label, raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: why };
    }
    const score = d.sign * t.score;
    const ref = t.sma50 != null ? (sd.kind === "yield" ? `${sgn(t.last - t.sma50)}${fmtN(Math.abs(t.last - t.sma50) * 100, 0)} bp vs 50d SMA` : `${fmtPct(t.last / t.sma50 - 1)} vs 50d SMA`) : "SMA50 n/a";
    const mom = t.mom20 == null ? "" : sd.kind === "yield" ? ` · 20d ${sgn(t.mom20)}${fmtN(Math.abs(t.mom20) * 100, 0)} bp` : ` · 20d ${fmtPct(t.mom20)}`;
    if (id === "dollarRates" && t.sma50 != null) {
      ctx.flips.push({ driver: "dollarRates", text: `${sd.label} closing ${t.last >= t.sma50 ? "below" : "above"} its 50-day SMA (${sd.kind === "yield" ? `${fmtN(t.sma50, 3)}%` : px(t.sma50)}) would weaken that dollar/rates leg (now ${sd.kind === "yield" ? `${fmtN(t.last, 3)}%` : px(t.last)}).` });
    }
    return {
      id: d.series, label, raw: `${sd.kind === "yield" ? `${fmtN(t.last, 3)}%` : px(t.last)} · ${ref}${mom} — ${d.why}`,
      rawValue: t.mom20, score, direction: dirOf(score),
    };
  });
  return makeDriver(id, ctx.inst, comps);
}

function riskDriver(ctx: Ctx): DriverResult {
  const { inst } = ctx;
  if (inst.riskSens === 0) return makeDriver("risk", inst, [], { note: "Not applicable to this instrument." });
  const s = inst.riskSens;
  const sensNote = s > 0 ? "risk-on is bullish for this instrument" : "risk-on is bearish for this instrument";
  const comps: Component[] = [];

  const vix = seriesFor(ctx, "VIX", false);
  const vt = vix.bars.length ? trendOf(vix.bars, "vol", ["sma50", "mom20"]) : null;
  if (vix.bars.length && vt) {
    const lvlScore = -Math.tanh((vt.last - 20) / 6);
    comps.push({ id: "vixLevel", label: "VIX level", raw: `${fmtN(vt.last, 2)} (neutral anchor 20; ${sensNote})`, rawValue: vt.last, score: s * lvlScore, direction: dirOf(s * lvlScore) });
    if (vt.score != null) {
      const sc = -s * vt.score;
      comps.push({ id: "vixTrend", label: "VIX trend (SMA50, 20d)", raw: `${vt.components.map((c) => c.raw).join(" · ")}`, rawValue: vt.mom20, score: sc, direction: dirOf(sc) });
    } else comps.push({ id: "vixTrend", label: "VIX trend", raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: "too few VIX bars" });
    ctx.flips.push({ driver: "risk", text: `VIX moving ${vt.last <= 20 ? "above" : "below"} 20 (now ${fmtN(vt.last, 2)}) would flip the VIX-level leg ${vt.last <= 20 ? "to risk-off" : "to risk-on"}.` });
  } else {
    const why = vix.missing ?? "too few VIX bars";
    ctx.warnings.push(`Risk regime: VIX ${why}.`);
    comps.push({ id: "vixLevel", label: "VIX level", raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: why });
    comps.push({ id: "vixTrend", label: "VIX trend", raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: why });
  }

  if (!inst.riskIsEquity) {
    const eq = seriesFor(ctx, "SPX", false);
    const et = eq.bars.length ? trendOf(eq.bars, "price") : null;
    if (et?.score != null) {
      const sc = s * et.score;
      comps.push({ id: "eqTrend", label: "Equity trend (S&P 500)", raw: `${et.components.map((c) => `${c.label.replace("Price vs ", "vs ")} ${c.raw.split(" (")[0]}`).join(" · ")}`, rawValue: et.mom20, score: sc, direction: dirOf(sc) });
    } else {
      const why = eq.missing ?? "too few S&P 500 bars";
      ctx.warnings.push(`Risk regime: S&P 500 ${why}.`);
      comps.push({ id: "eqTrend", label: "Equity trend (S&P 500)", raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: why });
    }
  }
  return makeDriver("risk", inst, comps, { note: `Sensitivity ${s > 0 ? "+1" : "−1"}: ${sensNote}.` });
}

function positioningDriver(ctx: Ctx): DriverResult {
  const { inst, inputs } = ctx;
  const map = inst.cot;
  if (!map) return makeDriver("positioning", inst, [], { note: "No COT contract maps to this instrument." });
  const base = { displayOnly: map.displayOnly };
  const cot: CotReading | null = inputs.cot;
  const na = (why: string): DriverResult => {
    ctx.warnings.push(`Positioning: ${why}`);
    return makeDriver("positioning", inst, [{ id: "pct3y", label: "Net percentile (3Y)", raw: "n/a", rawValue: null, score: null, direction: "n/a", missing: why }], { note: map.why, ...base });
  };
  if (!cot) return na(inputs.cotError ? `COT unavailable — ${inputs.cotError}` : "no COT report available for this contract.");
  if (cot.pct3y == null) return na(`${cot.contractName} has fewer than 156 weekly reports, so no 3Y percentile.`);
  const score = map.sign * ((cot.pct3y - 50) / 50);
  const comps: Component[] = [
    { id: "pct3y", label: `${cot.groupLabel} net percentile (3Y)${map.sign < 0 ? ", inverted" : ""}`, raw: `${Math.round(cot.pct3y)} of 100 (${cot.contractName}, positions as of ${cot.asOf})`, rawValue: cot.pct3y, score, direction: dirOf(score) },
    { id: "net", label: `${cot.groupLabel} net position`, raw: `${cot.net.toLocaleString("en-US")}${cot.changeNet == null ? "" : ` (${sgn(cot.changeNet)}${Math.abs(cot.changeNet).toLocaleString("en-US")} w/w)`}`, rawValue: cot.net, score: null, direction: "n/a", infoOnly: true },
    { id: "pct5y", label: "Net percentile (5Y)", raw: cot.pct5y == null ? "n/a" : `${Math.round(cot.pct5y)} of 100`, rawValue: cot.pct5y, score: null, direction: "n/a", infoOnly: true },
  ];
  if (!map.displayOnly) ctx.flips.push({ driver: "positioning", text: `${cot.groupLabel} net percentile ${cot.pct3y >= 50 ? "falling below" : "rising above"} 50 (now ${Math.round(cot.pct3y)}) would turn positioning ${map.sign * (cot.pct3y >= 50 ? 1 : -1) > 0 ? "bearish" : "bullish"}; reports are weekly.` });
  return makeDriver("positioning", inst, comps, { note: map.displayOnly ? `Display-only (weight 0). ${map.why}` : map.why, ...base });
}

// ───────────── composite ─────────────

export function computeLean(inputs: LeanInputs): LeanResult {
  const inst = INSTRUMENT_BY_ID[inputs.instrumentId];
  if (!inst) throw new Error(`Unknown lean instrument "${inputs.instrumentId}"`);
  const ctx: Ctx = { inst, inputs, flips: [], warnings: [], lastBar: {} };

  const drivers: DriverResult[] = [
    trendDriver(ctx),
    positioningDriver(ctx),
    signedDriver(ctx, "dollarRates", inst.dollarRates),
    riskDriver(ctx),
    signedDriver(ctx, "cross", inst.cross),
  ];

  const weighted = drivers.filter((d) => d.weight > 0);
  const avail = weighted.filter((d) => d.score != null);
  const wSum = avail.reduce((a, d) => a + d.weight, 0);
  const numer = avail.reduce((a, d) => a + d.weight * d.score!, 0);
  const absNumer = avail.reduce((a, d) => a + d.weight * Math.abs(d.score!), 0);
  const composite = wSum > 0 ? numer / wSum : null;
  const signAgreement = absNumer > 0 ? Math.abs(numer) / absNumer : 0;
  const allW = weighted.reduce((a, d) => a + d.weight, 0);
  const completeness = allW > 0 ? weighted.reduce((a, d) => a + d.weight * (d.score == null ? 0 : d.completeness), 0) / allW : 0;
  const driverAgreement = composite == null ? 0 : Math.round(100 * signAgreement * completeness);
  const label: LeanLabel = composite == null ? "Insufficient data"
    : composite >= LEAN_THRESHOLD ? "Bullish lean" : composite <= -LEAN_THRESHOLD ? "Bearish lean" : "Mixed";

  // Cross-asset: how many confirmers agree with the composite's direction.
  const crossD = drivers.find((d) => d.id === "cross")!;
  const ref = composite == null ? 0 : Math.sign(composite);
  const conf = { agree: 0, against: 0, neutral: 0, total: crossD.components.length };
  for (const c of crossD.components) {
    if (c.score == null || ref === 0 || Math.abs(c.score) < NEUTRAL_BAND) conf.neutral++;
    else if (Math.sign(c.score) === ref) conf.agree++;
    else conf.against++;
  }

  if (composite != null && avail.length < 2) {
    ctx.warnings.push(`Only ${avail.length} driver${avail.length === 1 ? " carries" : "s carry"} weight, so driver agreement reflects data completeness only and says nothing about reliability.`);
  }

  const flips: Flip[] = [];
  if (composite != null) {
    const T = LEAN_THRESHOLD;
    const c = composite;
    flips.unshift({
      text: label === "Mixed"
        ? `Composite is ${sgn(c)}${fmtN(Math.abs(c), 2)}. It becomes a Bullish lean at +${fmtN(T, 2)} or above and a Bearish lean at −${fmtN(T, 2)} or below.`
        : `Composite is ${sgn(c)}${fmtN(Math.abs(c), 2)}. It reverts to Mixed once it ${c > 0 ? "falls below" : "rises above"} ${c > 0 ? "+" : "−"}${fmtN(T, 2)}, and flips direction only past ${c > 0 ? "−" : "+"}${fmtN(T, 2)}.`,
    });
  }
  // Only levels belonging to drivers that carry weight can change the lean; say so for the rest.
  const weightOf = (id: DriverId) => drivers.find((d) => d.id === id)?.weight ?? 0;
  flips.push(...ctx.flips.filter((f) => weightOf(f.driver) > 0).map((f) => ({ text: f.text })));
  const zeroed = drivers.filter((d) => d.weight === 0 && d.components.length > 0 && !(d.id === "positioning" && inst.cot?.displayOnly)).map((d) => d.label);
  if (zeroed.length) flips.push({ text: `${zeroed.join(", ")} carry weight 0 (walk-forward test found no demonstrated edge), so crossing their levels does not change the lean even though they are shown.` });

  const own = ctx.lastBar[inst.series] ?? null;
  return {
    instrumentId: inst.id, label, composite, driverAgreement, signAgreement, completeness, drivers,
    confirmers: conf, flips, warnings: ctx.warnings,
    freshness: { ownLastBar: own, seriesLastBar: ctx.lastBar, cotAsOf: inputs.cot?.asOf ?? null },
  };
}
