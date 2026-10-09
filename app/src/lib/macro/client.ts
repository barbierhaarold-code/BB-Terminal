import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { MacroSnapshot } from "./types";

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
