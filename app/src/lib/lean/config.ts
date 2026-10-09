import type { DriverId, SeriesKind } from "./types";
import backtest from "./backtest.json";

// ────────────────────────────────────────────────────────────
// Market Lean — configuration. Every weight, sign and mapping the engine uses
// lives here and is shown on the page's methodology panel.
// ────────────────────────────────────────────────────────────

/** Gold history comes from COMEX futures daily bars (roll gaps, basis vs spot), never from spot. */
export const GOLD_SOURCE_NOTE = "Gold futures (GC=F), not spot";

export interface SeriesDef { id: string; label: string; kind: SeriesKind; /** Yahoo symbol; absent for Fed yields */ yahoo?: string }

export const SERIES: Record<string, SeriesDef> = {
  XAU: { id: "XAU", label: GOLD_SOURCE_NOTE, kind: "price", yahoo: "GC=F" },
  DXY: { id: "DXY", label: "US Dollar Index", kind: "price", yahoo: "DX-Y.NYB" },
  EURUSD: { id: "EURUSD", label: "EUR/USD", kind: "price", yahoo: "EURUSD=X" },
  GBPUSD: { id: "GBPUSD", label: "GBP/USD", kind: "price", yahoo: "GBPUSD=X" },
  USDJPY: { id: "USDJPY", label: "USD/JPY", kind: "price", yahoo: "USDJPY=X" },
  AUDUSD: { id: "AUDUSD", label: "AUD/USD", kind: "price", yahoo: "AUDUSD=X" },
  USDCAD: { id: "USDCAD", label: "USD/CAD", kind: "price", yahoo: "USDCAD=X" },
  USDCHF: { id: "USDCHF", label: "USD/CHF", kind: "price", yahoo: "USDCHF=X" },
  NZDUSD: { id: "NZDUSD", label: "NZD/USD", kind: "price", yahoo: "NZDUSD=X" },
  SPX: { id: "SPX", label: "S&P 500", kind: "price", yahoo: "^GSPC" },
  NDX: { id: "NDX", label: "Nasdaq 100", kind: "price", yahoo: "^NDX" },
  WTI: { id: "WTI", label: "WTI crude (CL=F)", kind: "price", yahoo: "CL=F" },
  BTC: { id: "BTC", label: "Bitcoin", kind: "price", yahoo: "BTC-USD" },
  VIX: { id: "VIX", label: "VIX", kind: "vol", yahoo: "^VIX" },
  SILVER: { id: "SILVER", label: "Silver (SI=F)", kind: "price", yahoo: "SI=F" },
  GDX: { id: "GDX", label: "Gold miners (GDX)", kind: "price", yahoo: "GDX" },
  TIP: { id: "TIP", label: "TIPS ETF (TIP)", kind: "price", yahoo: "TIP" },
  EURJPY: { id: "EURJPY", label: "EUR/JPY", kind: "price", yahoo: "EURJPY=X" },
  AUDJPY: { id: "AUDJPY", label: "AUD/JPY", kind: "price", yahoo: "AUDJPY=X" },
  GBPJPY: { id: "GBPJPY", label: "GBP/JPY", kind: "price", yahoo: "GBPJPY=X" },
  COPPER: { id: "COPPER", label: "Copper (HG=F)", kind: "price", yahoo: "HG=F" },
  RUT: { id: "RUT", label: "Russell 2000", kind: "price", yahoo: "^RUT" },
  HYG: { id: "HYG", label: "High-yield credit (HYG)", kind: "price", yahoo: "HYG" },
  SMH: { id: "SMH", label: "Semiconductors (SMH)", kind: "price", yahoo: "SMH" },
  BRENT: { id: "BRENT", label: "Brent crude (BZ=F)", kind: "price", yahoo: "BZ=F" },
  XLE: { id: "XLE", label: "Energy sector (XLE)", kind: "price", yahoo: "XLE" },
  ETH: { id: "ETH", label: "Ethereum", kind: "price", yahoo: "ETH-USD" },
  SOL: { id: "SOL", label: "Solana", kind: "price", yahoo: "SOL-USD" },
  UST10: { id: "UST10", label: "US 10Y yield", kind: "yield" },
  UST2: { id: "UST2", label: "US 2Y yield", kind: "yield" },
};

/** Base weights. These start as a-priori values; `WEIGHT_NOTES` records what the walk-forward test did to them. */
export const BASE_WEIGHTS: Record<DriverId, number> = {
  trend: 0.35,
  positioning: 0.20,
  dollarRates: 0.20,
  risk: 0.15,
  cross: 0.10,
};

export const DRIVER_LABELS: Record<DriverId, string> = {
  trend: "Trend",
  positioning: "Positioning (COT)",
  dollarRates: "Dollar & rates",
  risk: "Risk regime",
  cross: "Cross-asset confirmation",
};

/** Wording shown wherever driver agreement appears (page, tooltips, methodology, Copilot tool). */
export const DRIVER_AGREEMENT_NOTE = "Share of weighted drivers pointing the same way. Not a probability of being right.";

/** |composite| at or above this = Supportive / Headwind backdrop; below = Neutral. */
export const LEAN_THRESHOLD = 0.25;
/** |score| below this reads as neutral for a component's direction arrow. */
export const NEUTRAL_BAND = 0.1;

export interface Signed { series: string; sign: 1 | -1; why: string }

export interface CotMap {
  contractKey: string;
  groupId: string;
  /** +1: net long in that contract means the instrument is bullish; -1: inverted (USD/xxx pairs) */
  sign: 1 | -1;
  /** shown but weight 0 */
  displayOnly: boolean;
  why: string;
}

export interface InstrumentDef {
  id: string;
  label: string;
  short: string;
  /** SERIES id of the instrument itself */
  series: string;
  group: "Metals" | "FX" | "Index" | "Energy" | "Crypto";
  cot: CotMap | null;
  /** Dollar & rates components (signs already applied: +1 = a rising series is bullish for this instrument) */
  dollarRates: Signed[];
  /** +1: risk-on is bullish, -1: risk-on is bearish, 0: not applicable */
  riskSens: 1 | -1 | 0;
  /** skip the equity-trend leg of the risk regime (the instrument IS the equity trend) */
  riskIsEquity?: boolean;
  cross: Signed[];
  /** where the instrument's own history comes from, when that is not obvious */
  sourceNote?: string;
}

const DXYd = (sign: 1 | -1, why: string): Signed => ({ series: "DXY", sign, why });
const Y10 = (sign: 1 | -1, why: string): Signed => ({ series: "UST10", sign, why });
const Y2 = (sign: 1 | -1, why: string): Signed => ({ series: "UST2", sign, why });

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: "XAUUSD", label: "Gold (XAU/USD)", short: "XAUUSD", series: "XAU", group: "Metals", sourceNote: GOLD_SOURCE_NOTE,
    cot: { contractKey: "gold", groupId: "m_money", sign: 1, displayOnly: false, why: "COMEX gold, Managed Money: the speculative group in the Disaggregated report." },
    dollarRates: [DXYd(-1, "stronger dollar weighs on gold"), Y10(-1, "higher nominal yields raise the cost of holding gold"), Y2(-1, "higher front-end yields, same logic"), { series: "TIP", sign: 1, why: "real-yield proxy: TIPS price up ≈ real yields down" }],
    riskSens: -1,
    cross: [{ series: "SILVER", sign: 1, why: "silver follows gold" }, { series: "GDX", sign: 1, why: "miners confirm metal strength" }, { series: "COPPER", sign: 1, why: "industrial metals confirm reflation moves" }],
  },
  {
    id: "DXY", label: "US Dollar Index", short: "DXY", series: "DXY", group: "FX",
    cot: { contractKey: "dxy", groupId: "lev_money", sign: 1, displayOnly: false, why: "ICE dollar index future, Leveraged Funds. The contract is thin; read with care." },
    dollarRates: [Y10(1, "higher US yields support the dollar"), Y2(1, "higher front-end yields support the dollar")],
    riskSens: -1,
    cross: [{ series: "EURUSD", sign: -1, why: "EUR is 57% of the index" }, { series: "USDJPY", sign: 1, why: "JPY is 14% of the index" }, { series: "GBPUSD", sign: -1, why: "GBP is 12% of the index" }],
  },
  {
    id: "EURUSD", label: "EUR/USD", short: "EURUSD", series: "EURUSD", group: "FX",
    cot: { contractKey: "eur", groupId: "lev_money", sign: 1, displayOnly: false, why: "CME Euro FX, Leveraged Funds; long euro futures = long EUR/USD." },
    dollarRates: [DXYd(-1, "dollar strength is the other side of the pair"), Y10(-1, "higher US yields favour USD"), Y2(-1, "higher US front-end yields favour USD")],
    riskSens: 1,
    cross: [{ series: "GBPUSD", sign: 1, why: "dollar-bloc co-movement" }, { series: "AUDUSD", sign: 1, why: "dollar-bloc co-movement" }, { series: "USDCHF", sign: -1, why: "CHF moves with EUR vs USD" }],
  },
  {
    id: "GBPUSD", label: "GBP/USD", short: "GBPUSD", series: "GBPUSD", group: "FX",
    cot: { contractKey: "gbp", groupId: "lev_money", sign: 1, displayOnly: false, why: "CME British Pound, Leveraged Funds." },
    dollarRates: [DXYd(-1, "dollar strength is the other side of the pair"), Y10(-1, "higher US yields favour USD"), Y2(-1, "higher US front-end yields favour USD")],
    riskSens: 1,
    cross: [{ series: "EURUSD", sign: 1, why: "dollar-bloc co-movement" }, { series: "AUDUSD", sign: 1, why: "dollar-bloc co-movement" }, { series: "USDCHF", sign: -1, why: "CHF moves with GBP vs USD" }],
  },
  {
    id: "USDJPY", label: "USD/JPY", short: "USDJPY", series: "USDJPY", group: "FX",
    cot: { contractKey: "jpy", groupId: "lev_money", sign: -1, displayOnly: false, why: "CME Japanese Yen, Leveraged Funds, INVERTED: long yen futures = short USD/JPY." },
    dollarRates: [DXYd(1, "dollar strength lifts USD/xxx"), Y10(1, "USD/JPY is the most yield-sensitive major"), Y2(1, "higher front-end yields widen the carry")],
    riskSens: 1,
    cross: [{ series: "EURJPY", sign: 1, why: "yen crosses share the yen leg" }, { series: "AUDJPY", sign: 1, why: "yen crosses share the yen leg" }, { series: "GBPJPY", sign: 1, why: "yen crosses share the yen leg" }],
  },
  {
    id: "AUDUSD", label: "AUD/USD", short: "AUDUSD", series: "AUDUSD", group: "FX",
    cot: { contractKey: "aud", groupId: "lev_money", sign: 1, displayOnly: false, why: "CME Australian Dollar, Leveraged Funds." },
    dollarRates: [DXYd(-1, "dollar strength is the other side of the pair"), Y10(-1, "higher US yields favour USD"), Y2(-1, "higher US front-end yields favour USD")],
    riskSens: 1,
    cross: [{ series: "NZDUSD", sign: 1, why: "antipodean twin" }, { series: "COPPER", sign: 1, why: "AUD tracks industrial metals" }, { series: "SPX", sign: 1, why: "AUD is a risk currency" }],
  },
  {
    id: "USDCAD", label: "USD/CAD", short: "USDCAD", series: "USDCAD", group: "FX",
    cot: { contractKey: "cad", groupId: "lev_money", sign: -1, displayOnly: false, why: "CME Canadian Dollar, Leveraged Funds, INVERTED: long CAD futures = short USD/CAD." },
    dollarRates: [DXYd(1, "dollar strength lifts USD/xxx"), Y10(1, "higher US yields favour USD"), Y2(1, "higher US front-end yields favour USD")],
    riskSens: -1,
    cross: [{ series: "WTI", sign: -1, why: "CAD is an oil currency" }, { series: "AUDUSD", sign: -1, why: "commodity-currency twin, inverted" }, { series: "NZDUSD", sign: -1, why: "commodity-currency twin, inverted" }],
  },
  {
    id: "USDCHF", label: "USD/CHF", short: "USDCHF", series: "USDCHF", group: "FX",
    cot: { contractKey: "chf", groupId: "lev_money", sign: -1, displayOnly: false, why: "CME Swiss Franc, Leveraged Funds, INVERTED: long CHF futures = short USD/CHF." },
    dollarRates: [DXYd(1, "dollar strength lifts USD/xxx"), Y10(1, "higher US yields favour USD"), Y2(1, "higher US front-end yields favour USD")],
    riskSens: 1,
    cross: [{ series: "EURUSD", sign: -1, why: "CHF trades like a EUR proxy, inverted vs USD" }, { series: "XAU", sign: -1, why: "gold and CHF are both havens" }, { series: "USDJPY", sign: 1, why: "USD leg shared" }],
  },
  {
    id: "NZDUSD", label: "NZD/USD", short: "NZDUSD", series: "NZDUSD", group: "FX",
    cot: { contractKey: "nzd", groupId: "lev_money", sign: 1, displayOnly: false, why: "CME NZ Dollar, Leveraged Funds." },
    dollarRates: [DXYd(-1, "dollar strength is the other side of the pair"), Y10(-1, "higher US yields favour USD"), Y2(-1, "higher US front-end yields favour USD")],
    riskSens: 1,
    cross: [{ series: "AUDUSD", sign: 1, why: "antipodean twin" }, { series: "COPPER", sign: 1, why: "commodity-currency link" }, { series: "SPX", sign: 1, why: "NZD is a risk currency" }],
  },
  {
    id: "SPX", label: "S&P 500", short: "SPX", series: "SPX", group: "Index",
    cot: { contractKey: "es", groupId: "lev_money", sign: 1, displayOnly: true, why: "E-mini S&P, Leveraged Funds. Display-only: leveraged funds are structurally net short against long asset managers (basis / relative-value), so a negative net is NOT bearish." },
    dollarRates: [DXYd(-1, "stronger dollar tightens conditions for US multinationals"), Y10(-1, "rising long yields compress valuations"), Y2(-1, "rising front-end yields tighten policy")],
    riskSens: 1, riskIsEquity: true,
    cross: [{ series: "NDX", sign: 1, why: "growth leadership" }, { series: "RUT", sign: 1, why: "breadth: small caps" }, { series: "HYG", sign: 1, why: "credit confirms risk appetite" }],
  },
  {
    id: "NDX", label: "Nasdaq 100", short: "NDX", series: "NDX", group: "Index",
    cot: { contractKey: "nq", groupId: "lev_money", sign: 1, displayOnly: true, why: "E-mini Nasdaq-100, Leveraged Funds. Display-only for the same basis / relative-value reason as the S&P." },
    dollarRates: [DXYd(-1, "stronger dollar weighs on mega-cap earnings"), Y10(-1, "long-duration equities are rate-sensitive"), Y2(-1, "rising front-end yields tighten policy")],
    riskSens: 1, riskIsEquity: true,
    cross: [{ series: "SPX", sign: 1, why: "broad market" }, { series: "SMH", sign: 1, why: "semiconductor leadership" }, { series: "HYG", sign: 1, why: "credit confirms risk appetite" }],
  },
  {
    id: "WTI", label: "WTI crude oil", short: "WTI", series: "WTI", group: "Energy",
    cot: { contractKey: "wti", groupId: "m_money", sign: 1, displayOnly: false, why: "NYMEX WTI, Managed Money (producers/merchants are hedgers and are excluded)." },
    dollarRates: [DXYd(-1, "oil is priced in dollars")],
    riskSens: 1,
    cross: [{ series: "BRENT", sign: 1, why: "global benchmark" }, { series: "XLE", sign: 1, why: "energy equities" }, { series: "USDCAD", sign: -1, why: "CAD is an oil currency" }],
  },
  {
    id: "BTC", label: "Bitcoin", short: "BTC", series: "BTC", group: "Crypto",
    cot: { contractKey: "btc", groupId: "lev_money", sign: 1, displayOnly: true, why: "CME Bitcoin, Leveraged Funds. Display-only: leveraged funds are largely on the short side of the futures/spot basis trade, so a negative net is NOT bearish." },
    dollarRates: [DXYd(-1, "dollar liquidity"), Y10(-1, "higher real rates weigh on speculative assets")],
    riskSens: 1,
    cross: [{ series: "ETH", sign: 1, why: "crypto beta" }, { series: "NDX", sign: 1, why: "tech/risk co-movement" }, { series: "SOL", sign: 1, why: "crypto beta" }],
  },
];

export const INSTRUMENT_BY_ID: Record<string, InstrumentDef> = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));

/**
 * Walk-forward multiplier per driver: 1 = the driver beat chance by >= 1 standard error on the TRAIN
 * period (2012–2019) and keeps its a-priori weight; 0 = it did not, so it is shown but carries no weight.
 * Read from the stored walk-forward result (backtest.json), never hand-edited. The backtest script
 * resets this to all-1 for its first pass.
 */
export const WALK_FORWARD_MULT: Record<DriverId, number> = Object.fromEntries(
  (["trend", "positioning", "dollarRates", "risk", "cross"] as DriverId[]).map((d) => [
    d, (backtest as { decisions?: Record<string, { keep: boolean }> }).decisions?.[d]?.keep === false ? 0 : 1,
  ]),
) as Record<DriverId, number>;

/** Effective weight = a-priori weight × walk-forward multiplier; display-only COT is always 0. */
export function effectiveWeight(inst: InstrumentDef, driver: DriverId): number {
  if (driver === "positioning" && (!inst.cot || inst.cot.displayOnly)) return 0;
  return BASE_WEIGHTS[driver] * WALK_FORWARD_MULT[driver];
}

/** Series ids the page needs to download for the whole instrument set. */
export function allSeriesIds(): string[] {
  const s = new Set<string>(["VIX", "SPX", "UST10", "UST2"]);
  for (const i of INSTRUMENTS) {
    s.add(i.series);
    i.dollarRates.forEach((c) => s.add(c.series));
    i.cross.forEach((c) => s.add(c.series));
  }
  return [...s];
}
