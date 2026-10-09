import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchHistorical, fetchTreasuryRates, fetchSpotQuote, SPOT_GOLD_SYMBOL } from "@/lib/api";
import { cotCategory, cotContract, getCotSnapshot, type CotSnapshot } from "@/lib/cot";
import { INSTRUMENTS, SERIES, allSeriesIds } from "./config";
import { computeLean } from "./score";
import type { Bar, CotReading, LeanResult } from "./types";

// ────────────────────────────────────────────────────────────
// Market Lean data layer. One cached "bundle" holds every daily series the
// engine needs, so the 13 instruments share a handful of requests:
//   • Yahoo daily bars via the existing /api proxy (server-cached), batched 7
//     symbols per request and run 3 at a time — the browser allows 6 connections
//     per origin and the rest of the terminal needs some of them.
//   • Fed H.15 2Y/10Y yields via the existing treasury proxy.
//   • COT via the shared module (same cache as the COT page).
// The bundle is single-flight (react-query dedupes by key) and cached 15 min.
// Partial failures are kept per series with their real cause and surfaced by
// the engine as n/a components; only "nothing at all" is a page-level error.
// ────────────────────────────────────────────────────────────

const HISTORY_DAYS = 430; // ≥ 200 trading days for the SMA200 plus a margin
const CHUNK = 7;
const CONCURRENCY = 3;
const BUNDLE_STALE_MS = 15 * 60_000;

export interface LeanBundle {
  series: Record<string, Bar[]>;
  seriesErrors: Record<string, string>;
  cot: CotSnapshot | null;
  cotError?: string;
  fetchedAt: string;
  loadMs: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

export async function fetchLeanBundle(): Promise<LeanBundle> {
  const t0 = performance.now();
  const start_date = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const series: Record<string, Bar[]> = {};
  const seriesErrors: Record<string, string> = {};

  const yahooIds = allSeriesIds().filter((id) => SERIES[id].kind !== "yield");
  const bySymbol = new Map(yahooIds.map((id) => [SERIES[id].yahoo!, id]));
  const chunks: string[][] = [];
  for (let i = 0; i < yahooIds.length; i += CHUNK) chunks.push(yahooIds.slice(i, i + CHUNK).map((id) => SERIES[id].yahoo!));

  const tasks: (() => Promise<void>)[] = chunks.map((syms) => async () => {
    try {
      const rows = (await fetchHistorical(syms.join(","), { interval: "1d", start_date })) as unknown as { date: string; close: number | null; symbol?: string }[];
      for (const r of Array.isArray(rows) ? rows : []) {
        const id = r.symbol ? bySymbol.get(r.symbol) : undefined;
        if (!id || r.close == null) continue;
        (series[id] ??= []).push({ date: String(r.date).slice(0, 10), close: Number(r.close) });
      }
      for (const s of syms) {
        const id = bySymbol.get(s)!;
        if (!series[id]?.length) seriesErrors[id] = `Yahoo returned no rows for ${s}`;
      }
    } catch (e) {
      for (const s of syms) seriesErrors[bySymbol.get(s)!] = errText(e);
    }
  });
  tasks.push(async () => {
    try {
      const rows = await fetchTreasuryRates(HISTORY_DAYS);
      const mk = (k: "year_10" | "year_2"): Bar[] => rows.filter((r) => r[k] != null).map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r[k]) * 100 }));
      series.UST10 = mk("year_10"); series.UST2 = mk("year_2");
      for (const id of ["UST10", "UST2"]) if (!series[id].length) seriesErrors[id] = "Federal Reserve H.15 returned no rows";
    } catch (e) { seriesErrors.UST10 = seriesErrors.UST2 = errText(e); }
  });
  tasks.push(async () => { /* COT handled below so its failure never blocks the prices */ });

  let cot: CotSnapshot | null = null;
  let cotError: string | undefined;
  const cotTask = getCotSnapshot().then((s) => { cot = s; }).catch((e) => { cotError = errText(e); });

  await Promise.all([runPool(tasks, CONCURRENCY), cotTask]);
  for (const id of Object.keys(series)) series[id].sort((a, b) => (a.date < b.date ? -1 : 1));

  if (Object.values(series).every((b) => b.length === 0)) {
    const causes = [...new Set(Object.values(seriesErrors))].slice(0, 2).join(" · ");
    throw new Error(`No price history could be loaded${causes ? `: ${causes}` : "."}`);
  }
  return { series, seriesErrors, cot, cotError, fetchedAt: new Date().toISOString(), loadMs: Math.round(performance.now() - t0) };
}

export const leanBundleQuery = {
  queryKey: ["lean", "bundle"] as const,
  queryFn: fetchLeanBundle,
  staleTime: BUNDLE_STALE_MS,
  retry: 0, // like the News and COT panels: real cause + Retry immediately
};
export const useLeanBundle = () => useQuery(leanBundleQuery);
export const getLeanBundle = () => queryClient.fetchQuery(leanBundleQuery);

/** Live gold headline only. Shares the ticker tape's ["spot-quote"] cache key and never polls, so it adds no Twelve Data credits. */
export const useGoldHeadline = () =>
  useQuery({
    queryKey: ["spot-quote", SPOT_GOLD_SYMBOL] as const,
    queryFn: () => fetchSpotQuote(SPOT_GOLD_SYMBOL),
    staleTime: 60_000,
    retry: 0,
  });

// ───────────── bundle → results ─────────────

function cotReadingFor(snap: CotSnapshot | null, instId: string): { cot: CotReading | null; why?: string } {
  const inst = INSTRUMENTS.find((i) => i.id === instId)!;
  if (!inst.cot || !snap) return { cot: null };
  const c = cotContract(snap, inst.cot.contractKey);
  if (!c) return { cot: null, why: `contract "${inst.cot.contractKey}" is not in the COT snapshot` };
  if (!c.available) return { cot: null, why: c.reason };
  const cat = cotCategory(c, inst.cot.groupId);
  if (cat.id !== inst.cot.groupId) return { cot: null, why: `trader group "${inst.cot.groupId}" not found for ${c.name}` };
  return {
    cot: {
      contractKey: c.key, contractName: c.name, groupId: cat.id, groupLabel: cat.label, asOf: c.asOf,
      net: cat.net, changeNet: cat.changeNet, pct3y: cat.pct3y, pct5y: cat.pct5y,
    },
  };
}

export function leanFromBundle(b: LeanBundle): LeanResult[] {
  return INSTRUMENTS.map((inst) => {
    const own = b.series[inst.series] ?? [];
    const asOf = own.length ? own[own.length - 1].date : new Date().toISOString().slice(0, 10);
    const { cot, why } = cotReadingFor(b.cot, inst.id);
    return computeLean({
      instrumentId: inst.id, asOf, series: b.series, cot,
      seriesErrors: b.seriesErrors, cotError: b.cotError ?? why,
    });
  });
}

/** Imperative access to the SAME cached bundle the page uses (Copilot tool). */
export async function getMarketLeanResults() {
  const bundle = await getLeanBundle();
  return { bundle, results: leanFromBundle(bundle) };
}
