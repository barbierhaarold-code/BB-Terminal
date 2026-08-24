import type { OptionsRow } from "@/lib/api";

/** Average call/put IV at the strike nearest the underlying, for one expiry. */
export function atmIv(rows: OptionsRow[], expiration: string, underlying: number): number | null {
  const rowsAtExp = rows.filter((r) => r.expiration === expiration);
  if (rowsAtExp.length === 0) return null;
  let bestStrike: number | null = null;
  let bestDiff = Infinity;
  for (const r of rowsAtExp) {
    const diff = Math.abs(r.strike - underlying);
    if (diff < bestDiff) { bestDiff = diff; bestStrike = r.strike; }
  }
  if (bestStrike == null) return null;
  const ivs = rowsAtExp
    .filter((r) => r.strike === bestStrike)
    .map((r) => r.implied_volatility)
    .filter((v): v is number => v != null);
  if (ivs.length === 0) return null;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

export function groupByExpiry(rows: OptionsRow[]): Map<string, OptionsRow[]> {
  const m = new Map<string, OptionsRow[]>();
  for (const r of rows) {
    const arr = m.get(r.expiration);
    if (arr) arr.push(r); else m.set(r.expiration, [r]);
  }
  return m;
}
