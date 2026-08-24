/**
 * The free `nasdaq` provider for /economy/calendar (the only one that
 * doesn't need a paid key — fmp/tradingeconomics do) doesn't ship an
 * impact/importance rating. This is a keyword + economy-size heuristic
 * standing in for one, not a licensed impact feed — labelled as "Est."
 * impact in the UI so it isn't mistaken for one.
 */
const HIGH_KEYWORDS = [
  /\bgdp\b/i, /\bcpi\b/i, /nonfarm|non-farm|payrolls/i, /rate decision/i,
  /interest rate/i, /\bfomc\b/i, /\bpce\b/i, /unemployment rate/i, /\bpmi\b/i,
  /retail sales/i, /employment change/i, /inflation rate/i, /core cpi/i,
];
const MED_KEYWORDS = [
  /trade balance/i, /industrial production/i, /housing starts/i,
  /consumer confidence/i, /durable goods/i, /building permits/i,
  /current account/i, /manufacturing/i, /services/i, /sentiment/i, /confidence/i,
];
const MAJOR_COUNTRIES = new Set([
  "United States", "Euro Area", "European Union", "Germany", "United Kingdom",
  "Japan", "China", "France", "Italy", "Canada",
]);

export type Impact = "high" | "medium" | "low";

export function estimateImpact(ev: { event: string; country: string }): Impact {
  const isMajor = MAJOR_COUNTRIES.has(ev.country);
  if (HIGH_KEYWORDS.some((r) => r.test(ev.event))) return isMajor ? "high" : "medium";
  if (MED_KEYWORDS.some((r) => r.test(ev.event))) return isMajor ? "medium" : "low";
  return "low";
}

/** Loosely parses nasdaq's calendar value strings ("0.3%", "-7.2%", "1.24M",
 * " ", "-") into a plain number, or undefined if there's nothing numeric. */
export function parseCalendarNumber(s?: string): number | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t || t === "-" || t === "—") return undefined;
  const m = t.match(/-?[\d,.]+/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isNaN(n) ? undefined : n;
}

export function surprise(actual?: string, consensus?: string): number | undefined {
  const a = parseCalendarNumber(actual);
  const c = parseCalendarNumber(consensus);
  if (a == null || c == null) return undefined;
  return a - c;
}
