import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { COT_CONTRACT_BY_KEY, COT_LOOKBACKS } from "@/lib/cotContracts";
import { computeFreshness, freshnessLine, lateMessage } from "@/lib/cotMath";
import type {
  CotCategoryRow, CotContract, CotContractOk, CotHistory, CotSnapshot,
} from "@/lib/cotTypes";

// ────────────────────────────────────────────────────────────
// THE shared COT data module. Every consumer (COT page, Forex Gold Intelligence,
// Analytics/Quant, Copilot tools, and the future "Market Lean") goes through
// this file, so they all read the same snapshot from the same cache and can
// never disagree. Source: /cot-proxy (CFTC official public reporting API,
// futures-only), with a labeled fallback handled server-side.
//
// COT is WEEKLY: positions are as of Tuesday and published Friday 3:30 pm ET.
// Never present it as live — use `cotFreshness()` / `freshnessLine()` wherever
// the numbers are shown.
// ────────────────────────────────────────────────────────────

export type { CotSnapshot, CotContract, CotContractOk, CotCategoryRow, CotHistory, CotHistoryPoint } from "@/lib/cotTypes";
export { COT_CONTRACTS, COT_CONTRACT_BY_KEY, COT_CATEGORIES, COT_LOOKBACKS } from "@/lib/cotContracts";
export { freshnessLine, lateMessage, fmtCotDate } from "@/lib/cotMath";

async function cotGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/cot-proxy/${path}`);
  } catch (err) {
    throw new Error(`Could not reach the terminal server (${(err as Error).message}).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.results) {
    const why = body?.warnings?.[0]?.message ?? body?.message ?? body?.error;
    throw new Error(why ? String(why) : `COT proxy answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
  }
  return body.results as T;
}

export const fetchCotSnapshot = () => cotGet<CotSnapshot>("snapshot");
export const fetchCotHistory = (key: string) => cotGet<CotHistory>(`history/${key}`);

/** 30 min: the data changes weekly, and the server holds the real cache (hours). */
const SNAPSHOT_STALE_MS = 30 * 60_000;

export const cotSnapshotQuery = {
  queryKey: ["cot", "snapshot"] as const,
  queryFn: fetchCotSnapshot,
  staleTime: SNAPSHOT_STALE_MS,
  retry: 0, // like the News panels: show the real cause + a Retry button right away
};

/** Imperative access to the SAME cached snapshot the panels use (Copilot tools, future Market Lean). */
export const getCotSnapshot = () => queryClient.fetchQuery(cotSnapshotQuery);

export const useCotSnapshot = () => useQuery(cotSnapshotQuery);

export const useCotHistory = (key: string | null) =>
  useQuery({
    queryKey: ["cot", "history", key],
    queryFn: () => fetchCotHistory(key!),
    enabled: !!key,
    staleTime: SNAPSHOT_STALE_MS,
    retry: 0,
  });

// ───────────── selectors ─────────────

export function cotContract(snap: CotSnapshot | undefined, key: string): CotContract | undefined {
  return snap?.contracts.find((c) => c.key === key);
}

export function cotCategory(c: CotContractOk, id?: string): CotCategoryRow {
  return c.categories.find((x) => x.id === (id ?? c.primary)) ?? c.categories[0];
}

/** Freshness recomputed against the browser clock, so a tab left open still flags a late report. */
export function cotFreshness(snap: CotSnapshot) {
  if (!snap.asOf || !snap.freshness) return null;
  // `late` / next release re-derived from the browser clock; "published" stays as the server resolved it.
  return { ...computeFreshness(snap.asOf, Date.now(), null), published: snap.freshness.published, publishedBasis: snap.freshness.publishedBasis };
}

export function pctLabel(p: number | null | undefined): string {
  return p == null ? "n/a" : `${Math.round(p)}`;
}

/** Descriptive band for a percentile — wording describes where positioning sits in its own range, never a trade direction. */
export function pctBand(p: number | null | undefined): "n/a" | "extreme high" | "extreme low" | "mid-range" | "upper range" | "lower range" {
  if (p == null) return "n/a";
  if (p >= 90) return "extreme high";
  if (p <= 10) return "extreme low";
  if (p >= 66) return "upper range";
  if (p <= 34) return "lower range";
  return "mid-range";
}

export const PERCENTILE_DEFINITION =
  `Percentile = share of the last ${COT_LOOKBACKS.y3} (3Y) or ${COT_LOOKBACKS.y5} (5Y) weekly reports in which this group's net position was at or below today's. `
  + "100 = the highest net in the window, near 0 = the lowest.";

/**
 * Compact, serialisable summary for the Copilot (and any other text consumer).
 * Honest by construction: unavailable contracts say so, percentiles can be null.
 */
export function cotContractSummary(snap: CotSnapshot, c: CotContract) {
  if (!c.available) return { contract: c.name, key: c.key, available: false as const, reason: c.reason };
  return {
    available: true as const,
    contract: c.name, key: c.key, cftcCode: c.code, market: c.market,
    positionsAsOf: c.asOf,
    openInterest: c.openInterest, openInterestWeeklyChange: c.openInterestChange,
    headlineCategory: cotCategory(c).label,
    categories: c.categories.map((r) => ({
      category: r.label, long: r.long, short: r.short, net: r.net,
      netWeeklyChange: r.changeNet, longWeeklyChange: r.changeLong, shortWeeklyChange: r.changeShort,
      percentile3y: r.pct3y == null ? null : Math.round(r.pct3y * 10) / 10,
      percentile5y: r.pct5y == null ? null : Math.round(r.pct5y * 10) / 10,
    })),
  };
}

export function cotSnapshotMeta(snap: CotSnapshot) {
  const f = cotFreshness(snap);
  return {
    source: snap.sourceLabel, usingFallback: snap.source !== "cftc", stale: snap.stale, basis: snap.basis,
    positionsAsOf: snap.asOf,
    freshness: f ? freshnessLine(f) : null,
    late: f?.late ?? false,
    lateNote: f?.late ? lateMessage(f) : undefined,
    warnings: snap.warnings,
    percentileDefinition: PERCENTILE_DEFINITION,
    note: "COT is weekly: positions are as of Tuesday and published the following Friday 3:30 pm ET. It is not live data. Percentiles describe how extreme positioning is vs its own history; they are not a trade signal.",
  };
}

export function isKnownCotKey(k: string): boolean {
  return k in COT_CONTRACT_BY_KEY;
}

// ───────────── formatting (explicit en-US: the UI is English-only regardless of browser locale) ─────────────

const nf = new Intl.NumberFormat("en-US");
export const fmtCotNum = (n: number | null | undefined) => (n == null ? "n/a" : nf.format(Math.round(n)));
export const fmtCotSigned = (n: number | null | undefined) =>
  n == null ? "n/a" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${nf.format(Math.abs(Math.round(n)))}`;
