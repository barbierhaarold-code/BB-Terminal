import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { HolderList, HoldStatus, ManagerListItem, ManagerPortfolio } from "./types";

// ────────────────────────────────────────────────────────────
// HOLD client. Same convention as the other panels: retry 0, the real cause + a Retry button.
// The server builds its index once per day from the SEC's bulk data (a few minutes the first time), so
// the status query polls while it is building and the data queries wait for "ready"/"mapping".
// ────────────────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try { res = await fetch(`/holdings-proxy/${path}`); }
  catch (err) { throw new Error(`Could not reach the terminal server (${(err as Error).message}).`); }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.results) {
    const why = body?.warnings?.[0]?.message ?? body?.message ?? body?.error;
    throw new Error(why ? String(why) : `Holdings proxy answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
  }
  return body.results as T;
}

export const fetchHoldStatus = () => getJson<HoldStatus>("status");
export const retryHold = () => getJson<HoldStatus>("retry");
export interface ManagersResult { latestPeriod: string; builtAt: string; dataSets: string[]; managers: ManagerListItem[]; missing: string[] }
export const fetchManagers = () => getJson<ManagersResult>("managers");
export const fetchManager = (cik: string) => getJson<ManagerPortfolio>(`manager?cik=${encodeURIComponent(cik)}`);
export type HoldersResult = HolderList & { note: string | null };
export const fetchHolders = (ticker: string) => getJson<HoldersResult>(`holders?ticker=${encodeURIComponent(ticker)}`);
export interface TickersResult { tickers: string[]; mapping: { done: number; total: number }; mappingDone: boolean }
export const fetchTickers = () => getJson<TickersResult>("tickers");

const BUILDING = new Set(["idle", "building", "mapping"]);

export const holdStatusQuery = {
  queryKey: ["hold", "status"] as const,
  queryFn: fetchHoldStatus,
  retry: 0,
  refetchInterval: (q: { state: { data?: HoldStatus } }) => { const s = q.state.data; return s && s.state !== "missing_contact" && BUILDING.has(s.state) ? 5_000 : false; },
};
export const useHoldStatus = () => useQuery(holdStatusQuery);

const STALE_MS = 30 * 60_000;
export const managersQuery = { queryKey: ["hold", "managers"] as const, queryFn: fetchManagers, staleTime: STALE_MS, retry: 0 };
export const useManagers = (enabled = true) => useQuery({ ...managersQuery, enabled });
export const useManager = (cik: string | null, enabled = true) => useQuery({ queryKey: ["hold", "manager", cik] as const, queryFn: () => fetchManager(cik!), enabled: enabled && !!cik, staleTime: STALE_MS, retry: 0 });
export const useHolders = (ticker: string | null, enabled = true) => useQuery({ queryKey: ["hold", "holders", ticker] as const, queryFn: () => fetchHolders(ticker!), enabled: enabled && !!ticker, staleTime: STALE_MS, retry: 0 });
export const useTickers = (enabled = true) => useQuery({ queryKey: ["hold", "tickers"] as const, queryFn: fetchTickers, enabled, staleTime: 5 * 60_000, retry: 0 });

export const getManagers = () => queryClient.fetchQuery(managersQuery);
