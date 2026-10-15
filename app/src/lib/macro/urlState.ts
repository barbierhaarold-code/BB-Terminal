import type { ChartTransform } from "./types";

// Deep links for the Macro Hub detail view, kept in the page URL's query string (the hash is reserved for sign-in):
//   ?macro=<series id>&mt=<transform>&mr=<range>&mo=<overlay series id>
// Reading never throws; writing uses history.replaceState so it adds no history entries and reloads nothing.

export type RangeKey = "1Y" | "5Y" | "10Y" | "MAX";
export const RANGES: RangeKey[] = ["1Y", "5Y", "10Y", "MAX"];
export interface MacroUrlState { id: string | null; transform: ChartTransform | null; range: RangeKey | null; overlay: string | null }

const TRANSFORMS: ChartTransform[] = ["level", "mom", "yoy", "ann3m", "diff"];
const ID = /^[a-z]{2}\.[a-z0-9_]{1,24}$/;

export function parseMacroUrl(search: string): MacroUrlState {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return { id: null, transform: null, range: null, overlay: null }; }
  const id = q.get("macro"), t = q.get("mt"), r = q.get("mr"), o = q.get("mo");
  return {
    id: id && ID.test(id) ? id : null,
    transform: t && (TRANSFORMS as string[]).includes(t) ? (t as ChartTransform) : null,
    range: r && (RANGES as string[]).includes(r) ? (r as RangeKey) : null,
    overlay: o && ID.test(o) ? o : null,
  };
}

/** The query string with the macro keys replaced (other parameters are kept as they are). */
export function withMacroUrl(search: string, s: Partial<MacroUrlState>): string {
  const q = new URLSearchParams(search);
  const set = (k: string, v: string | null | undefined) => { if (v) q.set(k, v); else q.delete(k); };
  if ("id" in s) set("macro", s.id);
  if ("transform" in s) set("mt", s.transform);
  if ("range" in s) set("mr", s.range);
  if ("overlay" in s) set("mo", s.overlay);
  if (!q.get("macro")) { q.delete("mt"); q.delete("mr"); q.delete("mo"); }
  const out = q.toString();
  return out ? `?${out}` : "";
}

export function readMacroUrl(): MacroUrlState {
  return typeof window === "undefined" ? { id: null, transform: null, range: null, overlay: null } : parseMacroUrl(window.location.search);
}
export function writeMacroUrl(s: Partial<MacroUrlState>) {
  if (typeof window === "undefined") return;
  try {
    const next = withMacroUrl(window.location.search, s);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}${window.location.hash}`);
  } catch { /* URL updates are a convenience; the view works without them */ }
}

/**
 * Whether the page may request the US catalogue (/macro-proxy/us) and the release calendar, both of which cost FRED
 * requests. Never on a plain overview open: only when the US filter is selected or the user opened the US section.
 * A detail view does not need the catalogue (it loads its own series).
 */
export const usSectionLoads = (econ: string, opened: boolean) => econ === "US" || opened;
