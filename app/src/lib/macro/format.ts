import type { ChartTransform, SeriesDef, Unit } from "./types";
import { fmtChange, fmtValue } from "./math";

// Unit-aware formatting for Macro Hub values (explicit en-US, English only). Formatting never rounds a value
// beyond its series' declared decimals and never changes its sign.

function money(v: number, unitScale: number, decimals: number): string {
  const usd = v * unitScale, a = Math.abs(usd);
  const [div, suffix] = a >= 1e12 ? [1e12, " tn"] : a >= 1e9 ? [1e9, " bn"] : a >= 1e6 ? [1e6, " mn"] : [1, ""];
  const d = div === 1 ? 0 : Math.max(1, Math.min(decimals, 2));
  return `${usd < 0 ? "−" : ""}$${(a / div).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${suffix}`;
}
const SCALE: Partial<Record<Unit, number>> = { usd: 1, usd_mn: 1e6, usd_bn: 1e9 };

/** A value in a given unit. */
export function fmtIn(v: number | null | undefined, unit: Unit, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  switch (unit) {
    case "%": return `${fmtValue(v, decimals)}%`;
    case "pp": return `${fmtValue(v, decimals)} pp`;
    case "bp": return `${fmtValue(v, decimals)} bp`;
    case "k": return `${fmtValue(v, decimals)}k`;
    case "persons": return fmtValue(v, 0);
    case "usd_hr": return `$${fmtValue(v, 2)}/h`;
    case "ratio": return `${fmtValue(v, decimals)}×`;
    case "index": return fmtValue(v, decimals);
    case "usd": case "usd_mn": case "usd_bn": return money(v, SCALE[unit]!, decimals);
  }
}

/** A change (signed) in a given unit; % units become percentage points. */
export function fmtDelta(v: number | null | undefined, unit: Unit, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (unit === "usd" || unit === "usd_mn" || unit === "usd_bn") { const s = money(Math.abs(v), SCALE[unit]!, decimals); return v === 0 ? s : `${v > 0 ? "+" : "−"}${s}`; }
  const s = fmtChange(v, unit === "persons" ? 0 : decimals);
  return unit === "%" || unit === "pp" ? `${s} pp` : unit === "k" ? `${s}k` : unit === "bp" ? `${s} bp` : unit === "usd_hr" ? `${s} $/h` : s;
}

/** Headline value of a series in its own unit. */
export const fmtHeadline = (d: SeriesDef, v: number | null | undefined) => fmtIn(v, d.unit, d.decimals);
export const fmtHeadlineDelta = (d: SeriesDef, v: number | null | undefined) => fmtDelta(v, d.unit, d.decimals);

/** Unit of a chart transformation of a series. */
export function transformUnit(d: SeriesDef, t: ChartTransform): Unit {
  if (t === "yoy" || t === "mom" || t === "ann3m") return "%";
  if (t === "diff") return d.transform === "diff" ? d.unit : (d.sourceUnit ?? d.unit) === "%" ? "pp" : (d.sourceUnit ?? d.unit);
  return d.transform === "none" ? d.unit : (d.sourceUnit ?? d.unit);
}
export function transformDecimals(d: SeriesDef, t: ChartTransform): number {
  if (t === "level" && d.transform !== "none") return (d.sourceUnit ?? d.unit) === "index" ? 2 : d.decimals;
  return d.decimals;
}
