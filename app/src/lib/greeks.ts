// ────── Black-Scholes Greeks ──────
// Standard closed-form Greeks computed client-side from data the `OMON`
// chain already provides (strike, spot, DTE, implied volatility). No
// dividend yield input is available from the current data layer, so `q` is
// treated as 0 throughout — a standard simplification for short-dated
// equity/ETF options, not accurate for high-yield dividend payers near an
// ex-date.

export type OptionType = "call" | "put";

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF via the Abramowitz–Stegun erf approximation (~1e-7 max error). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  vanna: number;
  charm: number;
}

/**
 * Black-Scholes Greeks (q = 0).
 * S = spot, K = strike, T = time to expiry in years, r = risk-free rate (decimal),
 * sigma = implied volatility (decimal).
 */
export function blackScholesGreeks(
  S: number, K: number, T: number, r: number, sigma: number, type: OptionType
): Greeks {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) {
    return { delta: 0, gamma: 0, vega: 0, theta: 0, vanna: 0, charm: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf1 = normPdf(d1);

  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf1 / (S * sigma * sqrtT);
  const vega = S * pdf1 * sqrtT; // per 1.0 (100%) vol change
  const vanna = -pdf1 * (d2 / sigma); // per unit vol
  // Charm, q = 0. Identical for call/put in that case (delta_put = delta_call - 1,
  // and the -1 term doesn't decay with time).
  const charm = -pdf1 * (2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT);

  const theta = type === "call"
    ? -(S * pdf1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCdf(d2)
    : -(S * pdf1 * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCdf(-d2);

  return { delta, gamma, vega, theta, vanna, charm };
}

/** Delta only — cheaper path for the IV-skew panel, which doesn't need the rest. */
export function blackScholesDelta(
  S: number, K: number, T: number, r: number, sigma: number, type: OptionType
): number {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  return type === "call" ? normCdf(d1) : normCdf(d1) - 1;
}

export const DAYS_PER_YEAR = 365;
export const CONTRACT_MULTIPLIER = 100;

/** Fallback risk-free rate when the treasury-rates fetch is unavailable. */
export const DEFAULT_RISK_FREE_RATE = 0.045;
