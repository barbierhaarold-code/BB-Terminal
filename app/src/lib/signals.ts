// Rule-based signal classifiers. These are heuristics, not predictions.
// Each check returns a level (bull/bear/neutral/na) and a one-line interpretation.

export type SignalLevel = "bull" | "bear" | "neutral" | "na";

export interface Signal {
  level: SignalLevel;
  label: string;
  detail?: string;
}

const bull = (label: string, detail?: string): Signal => ({ level: "bull", label, detail });
const bear = (label: string, detail?: string): Signal => ({ level: "bear", label, detail });
const neutral = (label: string, detail?: string): Signal => ({ level: "neutral", label, detail });
const na = (label: string): Signal => ({ level: "na", label });

export function sigMA(price?: number, ma?: number, name = "50d MA"): Signal {
  if (price == null || ma == null) return na(`${name} n/a`);
  const diff = ((price - ma) / ma) * 100;
  const detail = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`;
  if (diff >= 2) return bull(`Above ${name}`, detail);
  if (diff <= -2) return bear(`Below ${name}`, detail);
  return neutral(`At ${name}`, detail);
}

export function sig52w(price?: number, high?: number, low?: number): Signal {
  if (price == null || high == null || low == null) return na("52w range n/a");
  const fromHigh = ((price - high) / high) * 100;
  const rangePct = ((price - low) / (high - low)) * 100;
  const detail = `${rangePct.toFixed(0)}% of range`;
  if (fromHigh >= -3) return neutral("At 52w high", detail);
  if (fromHigh >= -15) return bull("Upper range", detail);
  if (fromHigh >= -35) return neutral("Mid range", detail);
  return bear("Lower range", detail);
}

export function sigPE(pe?: number): Signal {
  if (pe == null) return na("P/E n/a");
  if (pe < 0) return bear("Unprofitable (P/E)", `${pe.toFixed(1)}x`);
  if (pe < 12) return bull("Cheap P/E", `${pe.toFixed(1)}x`);
  if (pe < 22) return neutral("Fair P/E", `${pe.toFixed(1)}x`);
  if (pe < 40) return bear("Rich P/E", `${pe.toFixed(1)}x`);
  return bear("Very rich P/E", `${pe.toFixed(1)}x`);
}

export function sigFwdPE(fwd?: number, trailing?: number): Signal {
  if (fwd == null) return na("Fwd P/E n/a");
  if (fwd < 0) return bear("Fwd earnings negative");
  const base = `${fwd.toFixed(1)}x`;
  if (trailing != null && trailing > 0) {
    const chg = ((fwd - trailing) / trailing) * 100;
    if (chg < -15) return bull("Fwd P/E improving", `${base} (earnings rising)`);
    if (chg > 15) return bear("Fwd P/E rising", `${base} (earnings falling)`);
  }
  if (fwd < 15) return bull("Low Fwd P/E", base);
  if (fwd < 25) return neutral("Fair Fwd P/E", base);
  return bear("Rich Fwd P/E", base);
}

export function sigEvEbitda(ev?: number): Signal {
  if (ev == null) return na("EV/EBITDA n/a");
  if (ev < 0) return bear("EBITDA negative");
  if (ev < 10) return bull("Cheap EV/EBITDA", `${ev.toFixed(1)}x`);
  if (ev < 18) return neutral("Fair EV/EBITDA", `${ev.toFixed(1)}x`);
  return bear("Rich EV/EBITDA", `${ev.toFixed(1)}x`);
}

export function sigMargin(margin?: number, kind: "gross" | "op" | "net" = "op"): Signal {
  if (margin == null) return na(`${kind} margin n/a`);
  const pct = margin * 100;
  const label = kind === "gross" ? "Gross margin" : kind === "op" ? "Operating margin" : "Net margin";
  const detail = `${pct.toFixed(1)}%`;
  const thresholds = { gross: [20, 40], op: [8, 18], net: [5, 12] } as const;
  const [low, hi] = thresholds[kind];
  if (pct >= hi) return bull(`${label} strong`, detail);
  if (pct >= low) return neutral(`${label} average`, detail);
  if (pct > 0) return bear(`${label} thin`, detail);
  return bear(`${label} negative`, detail);
}

export function sigGrowth(rate?: number, what = "Revenue"): Signal {
  if (rate == null) return na(`${what} growth n/a`);
  const pct = rate * 100;
  const detail = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% YoY`;
  if (pct >= 15) return bull(`${what} accelerating`, detail);
  if (pct >= 5) return bull(`${what} growing`, detail);
  if (pct >= 0) return neutral(`${what} flat`, detail);
  if (pct > -10) return bear(`${what} declining`, detail);
  return bear(`${what} shrinking`, detail);
}

export function sigAnalystUpside(current?: number, target?: number): Signal {
  if (current == null || target == null) return na("Analyst target n/a");
  const up = ((target - current) / current) * 100;
  const detail = `${up >= 0 ? "+" : ""}${up.toFixed(1)}% to target`;
  if (up >= 15) return bull("Bullish analyst target", detail);
  if (up >= 0) return neutral("Target near price", detail);
  return bear("Target below price", detail);
}

export function sigAnalystRec(rec?: string, score?: number): Signal {
  if (!rec) return na("No analyst coverage");
  const up = rec.toUpperCase();
  const s = score ?? 3;
  const detail = `score ${s.toFixed(2)}/5 (1=strong buy)`;
  if (/STRONG.BUY/.test(up) || s <= 1.8) return bull("Strong buy consensus", detail);
  if (/BUY/.test(up) || s <= 2.5) return bull("Buy consensus", detail);
  if (/HOLD|NEUTRAL/.test(up) || s <= 3.5) return neutral("Hold consensus", detail);
  return bear("Sell/underperform", detail);
}

export function sigDebtEquity(de?: number): Signal {
  if (de == null) return na("D/E n/a");
  const detail = `${de.toFixed(2)}`;
  if (de < 0.5) return bull("Low leverage", detail);
  if (de < 1.5) return neutral("Moderate leverage", detail);
  if (de < 3) return bear("High leverage", detail);
  return bear("Very high leverage", detail);
}

export function sigDividend(yieldDec?: number, payout?: number): Signal {
  if (yieldDec == null || yieldDec === 0) return neutral("No dividend");
  const y = yieldDec * 100;
  const yLabel = `${y.toFixed(2)}% yield`;
  if (payout != null) {
    const p = payout * 100;
    if (p > 90) return bear("Stretched payout", `${yLabel} · ${p.toFixed(0)}% payout`);
    if (p > 60) return neutral("High payout", `${yLabel} · ${p.toFixed(0)}% payout`);
    if (p > 0) return bull("Healthy payout", `${yLabel} · ${p.toFixed(0)}% payout`);
  }
  return neutral(yLabel);
}

export function sigROE(roe?: number): Signal {
  if (roe == null) return na("ROE n/a");
  const pct = roe * 100;
  const detail = `${pct.toFixed(1)}%`;
  if (pct >= 20) return bull("Strong ROE", detail);
  if (pct >= 10) return neutral("Fair ROE", detail);
  if (pct > 0) return bear("Weak ROE", detail);
  return bear("Negative ROE", detail);
}

export function sigROA(roa?: number): Signal {
  if (roa == null) return na("ROA n/a");
  const pct = roa * 100;
  const detail = `${pct.toFixed(1)}%`;
  if (pct >= 10) return bull("Strong ROA", detail);
  if (pct >= 4) return neutral("Fair ROA", detail);
  if (pct > 0) return bear("Weak ROA", detail);
  return bear("Negative ROA", detail);
}

export interface ScoreTally {
  bull: number;
  bear: number;
  neutral: number;
  na: number;
  net: number; // bull - bear
  verdict: "Bullish" | "Bearish" | "Mixed" | "Sparse";
}

export function tally(signals: Signal[]): ScoreTally {
  const counts = { bull: 0, bear: 0, neutral: 0, na: 0 };
  for (const s of signals) counts[s.level]++;
  const informative = signals.length - counts.na;
  const net = counts.bull - counts.bear;
  let verdict: ScoreTally["verdict"] = "Mixed";
  if (informative < 3) verdict = "Sparse";
  else if (net >= Math.max(2, Math.ceil(informative * 0.4))) verdict = "Bullish";
  else if (net <= -Math.max(2, Math.ceil(informative * 0.4))) verdict = "Bearish";
  return { ...counts, net, verdict };
}

// ────── Letter grades (Equity Research — Fundamentals scorecard) ──────
// Reuses the existing sig* classifiers rather than re-encoding thresholds:
// a grade is just bull/neutral/bear signals rolled up into a 0-1 score.
export type Grade = "A" | "B" | "C" | "D" | "F";
export interface GradeResult { grade: Grade | "—"; score?: number; signals: Signal[]; }

const GRADE_LEVEL_SCORE: Record<SignalLevel, number | null> = { bull: 1, neutral: 0.55, bear: 0, na: null };

export function gradeFromSignals(signals: Signal[]): GradeResult {
  const scored = signals.map((s) => GRADE_LEVEL_SCORE[s.level]).filter((v): v is number => v != null);
  if (scored.length === 0) return { grade: "—", signals };
  const score = scored.reduce((a, b) => a + b, 0) / scored.length;
  let grade: Grade;
  if (score >= 0.85) grade = "A";
  else if (score >= 0.65) grade = "B";
  else if (score >= 0.45) grade = "C";
  else if (score >= 0.25) grade = "D";
  else grade = "F";
  return { grade, score, signals };
}

export const gradeColor = (g: Grade | "—") =>
  g === "A" || g === "B" ? "up" : g === "C" ? "amber" : g === "D" || g === "F" ? "down" : "text-term-muted";

export const levelColor = (lvl: SignalLevel) =>
  lvl === "bull" ? "up" : lvl === "bear" ? "down" : lvl === "neutral" ? "amber" : "text-term-muted";
export const levelDot = (lvl: SignalLevel) =>
  lvl === "bull" ? "bg-term-green" : lvl === "bear" ? "bg-term-red" : lvl === "neutral" ? "bg-term-amber" : "bg-term-muted";
