import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { MacroSnapshot } from "./types";
import type { MacroDetail } from "./detail";

// ────────────────────────────────────────────────────────────
// Macro Hub client. ONE request (/macro-proxy/snapshot) carries every series, so the
// page costs a single browser connection. Shared by the page and the Copilot tool,
// so they read the same cached snapshot and cannot disagree.
// ────────────────────────────────────────────────────────────

export async function fetchMacroSnapshot(): Promise<MacroSnapshot> {
  let res: Response;
  try {
    res = await fetch("/macro-proxy/snapshot");
  } catch (err) {
    throw new Error(`Could not reach the terminal server (${(err as Error).message}).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.results) {
    const why = body?.warnings?.[0]?.message ?? body?.message ?? body?.error;
    throw new Error(why ? String(why) : `Macro proxy answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
  }
  return body.results as MacroSnapshot;
}

/** 30 min in the browser: the data moves daily to quarterly, and the server holds the real cache (hours). */
const STALE_MS = 30 * 60_000;

export const macroSnapshotQuery = {
  queryKey: ["macro", "snapshot"] as const,
  queryFn: fetchMacroSnapshot,
  staleTime: STALE_MS,
  retry: 0, // like the News, COT and Market Context panels: show the real cause + a Retry button right away
};

export const useMacroSnapshot = () => useQuery(macroSnapshotQuery);
export const getMacroSnapshot = () => queryClient.fetchQuery(macroSnapshotQuery);

// ───────────── US deep coverage, indicator detail, US release calendar ─────────────

async function getResults<T>(url: string, label: string): Promise<T> {
  let res: Response;
  try { res = await fetch(url); } catch (err) { throw new Error(`Could not reach the terminal server (${(err as Error).message}).`); }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.results) {
    const why = body?.warnings?.[0]?.message ?? body?.message ?? body?.error;
    throw new Error(why ? String(why) : `${label} answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
  }
  return body.results as T;
}

/** The US deep-coverage catalogue: ONE request for every US series (loaded only when the US section is shown). */
export const usCatalogQuery = {
  queryKey: ["macro", "us"] as const,
  queryFn: () => getResults<MacroSnapshot>("/macro-proxy/us", "Macro proxy (US)"),
  staleTime: STALE_MS,
  retry: 0,
};
export const useUsCatalog = (enabled = true) => useQuery({ ...usCatalogQuery, enabled });

/** One indicator's detail (full history, revisions, release calendar, reactions). Cached server-side 6 h. */
export const macroDetailQuery = (id: string) => ({
  queryKey: ["macro", "detail", id] as const,
  queryFn: () => getResults<MacroDetail>(`/macro-proxy/series?id=${encodeURIComponent(id)}`, "Macro proxy (detail)"),
  staleTime: STALE_MS,
  retry: 0,
});
export const useMacroDetail = (id: string | null) => useQuery({ ...macroDetailQuery(id ?? ""), enabled: !!id });
export const getMacroDetail = (id: string) => queryClient.fetchQuery(macroDetailQuery(id));

export interface UsCalendar { fetchedAt: string; source: string; releases: Array<{ releaseId: number; name: string; series: string[]; next: string | null; error?: string }> }
export const useUsCalendar = (enabled = true) => useQuery({
  queryKey: ["macro", "calendar"] as const,
  queryFn: () => getResults<UsCalendar>("/macro-proxy/calendar", "Macro proxy (calendar)"),
  staleTime: STALE_MS, retry: 0, enabled,
});
