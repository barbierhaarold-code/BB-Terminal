import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { PolicySnapshot } from "./types";

// ────────────────────────────────────────────────────────────
// Policy Feed client. ONE request (/policy-proxy/feed) carries every feed. Shared by the page and the Copilot tool,
// so they read the same cached snapshot. The server refreshes each feed on its own provider-appropriate schedule
// (15 min); the browser re-asks every 15 min too. retry 0: the real cause + a Retry button, like the other panels.
// ────────────────────────────────────────────────────────────

export async function fetchPolicySnapshot(): Promise<PolicySnapshot> {
  let res: Response;
  try { res = await fetch("/policy-proxy/feed"); }
  catch (err) { throw new Error(`Could not reach the terminal server (${(err as Error).message}).`); }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.results) {
    const why = body?.warnings?.[0]?.message ?? body?.message ?? body?.error;
    throw new Error(why ? String(why) : `Policy proxy answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`);
  }
  return body.results as PolicySnapshot;
}

export const REFRESH_MS = 15 * 60_000;
export const policyQuery = { queryKey: ["policy", "feed"] as const, queryFn: fetchPolicySnapshot, staleTime: 5 * 60_000, refetchInterval: REFRESH_MS, retry: 0 };
export const usePolicyFeed = () => useQuery(policyQuery);
export const getPolicySnapshot = () => queryClient.fetchQuery(policyQuery);
