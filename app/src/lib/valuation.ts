// Pure DCF / intrinsic-value math. No fetching here — callers pass in
// financials already pulled by FA/the balance+cash fetchers so this module
// stays a computation layer, not a new data source (per the equity-research
// deep-dive spec).

export interface DcfInputs {
  /** Most recent trailing free cash flow (USD). */
  baseFcf: number;
  /** Annual FCF growth rate applied during the projection window, as a decimal (0.08 = 8%). */
  growthRate: number;
  /** Discount rate / WACC, as a decimal. */
  wacc: number;
  /** Perpetuity growth rate used for the terminal value, as a decimal. */
  terminalGrowth: number;
  /** Number of years to explicitly project before the terminal value. */
  years: number;
  sharesOutstanding: number;
  /** Net debt (total debt − cash); subtracted from enterprise value to reach equity value. */
  netDebt?: number;
}

export interface DcfYear { year: number; fcf: number; discounted: number; }

export interface DcfResult {
  projection: DcfYear[];
  terminalValueUndiscounted: number;
  terminalValueDiscounted: number;
  enterpriseValue: number;
  equityValue: number;
  fairValuePerShare?: number;
}

/** Multi-year DCF: explicit projection window + a discounted Gordon-growth terminal value. */
export function runDcf(inputs: DcfInputs): DcfResult {
  const { baseFcf, growthRate, wacc, terminalGrowth, years, sharesOutstanding, netDebt } = inputs;
  const projection: DcfYear[] = [];
  let fcf = baseFcf;
  for (let y = 1; y <= years; y++) {
    fcf = fcf * (1 + growthRate);
    const discounted = fcf / Math.pow(1 + wacc, y);
    projection.push({ year: y, fcf, discounted });
  }
  const lastFcf = projection[projection.length - 1]?.fcf ?? baseFcf;
  const spread = wacc - terminalGrowth;
  const terminalValueUndiscounted = spread > 0 ? (lastFcf * (1 + terminalGrowth)) / spread : NaN;
  const terminalValueDiscounted = Number.isFinite(terminalValueUndiscounted)
    ? terminalValueUndiscounted / Math.pow(1 + wacc, years)
    : NaN;
  const pvSum = projection.reduce((a, y) => a + y.discounted, 0);
  const enterpriseValue = pvSum + (Number.isFinite(terminalValueDiscounted) ? terminalValueDiscounted : 0);
  const equityValue = enterpriseValue - (netDebt ?? 0);
  const fairValuePerShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : undefined;
  return { projection, terminalValueUndiscounted, terminalValueDiscounted, enterpriseValue, equityValue, fairValuePerShare };
}

/**
 * Single-stage (Gordon growth) intrinsic value — a quicker, no-knobs
 * complement to the full multi-year DCF tab. Same underlying math, no
 * explicit projection years: capitalizes next year's FCF directly.
 */
export function intrinsicValuePerShare(
  baseFcf: number, growthRate: number, wacc: number, sharesOutstanding: number, netDebt = 0
): number | undefined {
  const spread = wacc - growthRate;
  if (spread <= 0 || sharesOutstanding <= 0) return undefined;
  const nextFcf = baseFcf * (1 + growthRate);
  const enterpriseValue = nextFcf / spread;
  return (enterpriseValue - netDebt) / sharesOutstanding;
}

/** CAGR between the first and last value in a chronologically-ascending series. */
export function cagr(series: number[]): number | undefined {
  const vals = series.filter((v) => v != null && Number.isFinite(v));
  if (vals.length < 2) return undefined;
  const first = vals[0];
  const last = vals[vals.length - 1];
  const periods = vals.length - 1;
  if (first <= 0 || last <= 0) return undefined;
  return Math.pow(last / first, 1 / periods) - 1;
}

/** Sensible DCF presets: a mature, market-average company with no strong view. */
export const DCF_PRESETS = {
  growthRate: 0.08,
  wacc: 0.09,
  terminalGrowth: 0.025,
  years: 5,
} as const;

export function marginOfSafety(fairValue: number | undefined, price: number | undefined): number | undefined {
  if (fairValue == null || price == null || price === 0) return undefined;
  return ((fairValue - price) / price) * 100;
}
