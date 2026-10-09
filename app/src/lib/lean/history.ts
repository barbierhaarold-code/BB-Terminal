import backtest from "./backtest.json";

// Plain-language "Historical agreement" text built from the stored walk-forward result. One source for the
// LEAN page and the Copilot tool, so neither can present the backdrop as predictive.

interface Ci { edgeLo: number; edgeHi: number; significant: "edge" | "worse" | "none" }
interface St { n: number; hitRate: number | null; expected: number | null; edge: number | null; ci?: Ci }

const bt = backtest as unknown as {
  start: string; dataThrough: string; generatedAt: string; split: string;
  drivers: Record<"all" | "train" | "test", Record<string, Record<"POOLED", Record<"5" | "20", St>>>>;
  decisions: Record<string, { z: number | null; keep: boolean }>;
  lean: Record<"all" | "train" | "test", Record<string, Record<"5" | "20", St & { nonOverlap20?: St }>>>;
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
const nf = (n: number) => n.toLocaleString("en-US");

/** "51.4% vs 49.8% chance, n=14,535, not significant (95% CI for the edge −3.6 to +6.9 pts)" */
export function agreementPhrase(s: St | undefined): string {
  if (!s || !s.n || s.hitRate == null || s.expected == null) return "no directional samples";
  const base = `${pct(s.hitRate)} vs ${pct(s.expected)} chance, n=${nf(s.n)}`;
  const c = s.ci;
  if (!c) return `${base}, no interval available`;
  const ci = `95% CI for the edge ${pts(c.edgeLo)} to ${pts(c.edgeHi)} pts`;
  if (c.significant === "none") return `${base}, not significant (${ci})`;
  if (c.significant === "worse") return `${base}, significantly WORSE than chance (${ci})`;
  return c.edgeLo < 0.005
    ? `${base}, marginal: interval only just excludes zero (${ci}), uncorrected for multiple comparisons`
    : `${base}, edge over chance at 95% (${ci}), uncorrected for multiple comparisons`;
}

export interface HistoricalAgreement {
  text: string;
  caveat: string;
  pooled: { next20d: string; next5d: string; nonOverlapping20d: string };
  instrument: { next20d: string; next5d: string } | null;
  period: string;
}

export function historicalAgreement(instrumentId?: string): HistoricalAgreement {
  const pooled = bt.lean.all.POOLED;
  const inst = instrumentId ? bt.lean.all[instrumentId] : undefined;
  const period = `${bt.start.slice(0, 4)}–${bt.dataThrough.slice(0, 4)}`;
  const p20 = agreementPhrase(pooled["20"]);
  const p5 = agreementPhrase(pooled["5"]);
  const no = agreementPhrase(pooled["20"].nonOverlap20);
  const i20 = inst ? agreementPhrase(inst["20"]) : null;
  const i5 = inst ? agreementPhrase(inst["5"]) : null;
  const caveat = "Days with a Supportive or Headwind backdrop only (Neutral excluded); consecutive days overlap, so n counts days, not independent observations. Intervals come from a block bootstrap over dates. Agreement with past moves does not make the backdrop predictive.";
  return {
    period, caveat,
    pooled: { next20d: p20, next5d: p5, nonOverlapping20d: no },
    instrument: inst ? { next20d: i20!, next5d: i5! } : null,
    text: `Walk-forward ${period}, 13 instruments pooled: next 20 days ${p20}; next 5 days ${p5}; non-overlapping 20-day check ${no}.${inst ? ` This instrument: next 20 days ${i20}; next 5 days ${i5}.` : ""}`,
  };
}

/** Shown on the risk row only when the stored walk-forward result says the driver was significantly below chance at 20 days. */
export function driverHistoryNote(driverId: string): string | null {
  const st = bt.drivers.all[driverId]?.POOLED?.["20"];
  return st?.ci?.significant === "worse" ? "Historically below chance at 20 days (shown for context, weight 0)." : null;
}

export interface WalkForwardRow { id: string; label: string; next20d: string; next5d: string; weight: string }

/** Pooled, full-period summary with 95% intervals for every driver and for the combined backdrop. */
export function walkForwardSummary() {
  const names: Record<string, string> = { trend: "Trend", positioning: "Positioning (COT)", dollarRates: "Dollar & rates", risk: "Risk regime", cross: "Cross-asset confirmation" };
  const rows: WalkForwardRow[] = Object.keys(names).map((id) => ({
    id, label: names[id],
    next20d: agreementPhrase(bt.drivers.all[id].POOLED["20"]),
    next5d: agreementPhrase(bt.drivers.all[id].POOLED["5"]),
    weight: bt.decisions[id]?.keep ? "keeps its weight" : "weight 0",
  }));
  rows.push({ id: "backdrop", label: "Combined backdrop (weighted drivers)", next20d: agreementPhrase(bt.lean.all.POOLED["20"]), next5d: agreementPhrase(bt.lean.all.POOLED["5"]), weight: "" });
  return {
    rows, start: bt.start, split: bt.split, dataThrough: bt.dataThrough, generatedAt: bt.generatedAt,
    rule: "Pre-registered before looking at the numbers: a driver keeps its a-priori weight only if, on the train period (before the split date), its pooled 20-day agreement beat chance by at least one standard error; otherwise its weight is 0. The test period never influenced a weight.",
    command: "cd app && npm run lean:backtest",
    note: "Re-run by hand when you want fresh numbers; it needs the local OpenBB API on :6900 and internet access to the CFTC. The terminal itself only reads the stored result and never runs it.",
  };
}
