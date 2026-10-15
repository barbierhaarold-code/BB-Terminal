import type { MacroSnapshot } from "./types";

// ────────────────────────────────────────────────────────────
// What the server really did for a Macro Hub answer (from MacroSnapshot.served), and the page's bounded self-refresh
// while a source is still loading in the background. Pure: no React, no fetch.
// ────────────────────────────────────────────────────────────

/** The status badge: where the series of this answer came from. */
export function servedLabel(snap: Pick<MacroSnapshot, "served" | "cacheState">): string {
  const s = snap.served;
  if (!s) return `server cache ${snap.cacheState}`; // a server older than the `served` field
  const cached = s.memory + s.disk;
  const parts = [
    cached && `${cached} cached${s.disk ? ` (${s.disk} from disk)` : ""}`,
    s.fetched && `${s.fetched} fetched`,
    s.stale && `${s.stale} stale${s.refreshing ? ` (${s.refreshing === s.stale ? "" : `${s.refreshing} `}refreshing)` : ""}`,
    s.pending && `${s.pending} still loading`,
  ].filter(Boolean);
  if (parts.length === 0) return "no series served";
  if (!s.fetched && !s.stale && !s.pending) return s.disk && !s.memory ? "served from disk cache" : s.disk ? `served from cache (${s.disk} from disk)` : "served from server cache";
  if (!cached && !s.stale && !s.pending) return "fetched from sources";
  return `${cached || s.stale ? "partly from cache" : "from sources"}: ${parts.join(" · ")}`;
}

/** Something on this answer will change by itself: a series is still loading, or a stale copy is being refreshed. */
export const awaitingBackground = (snap: Pick<MacroSnapshot, "served"> | undefined) => !!snap?.served && snap.served.pending + snap.served.refreshing > 0;

/** At most one refetch this often while something is pending… */
export const PENDING_POLL_MS = 10_000;
/** …and never for longer than this in a row: a source still not back after two minutes is left to the Refresh button. */
export const PENDING_POLL_MAX_MS = 120_000;

/**
 * A refetch-interval function for one query (react-query's `refetchInterval`): PENDING_POLL_MS while the latest answer
 * is waiting on background work, false otherwise, and false once it has been waiting for PENDING_POLL_MAX_MS.
 * The window restarts only after an answer with nothing pending.
 */
export function pendingPoller(now: () => number = Date.now) {
  let since: number | null = null;
  return (snap: Pick<MacroSnapshot, "served"> | undefined): number | false => {
    if (!awaitingBackground(snap)) { since = null; return false; }
    const t = now();
    since ??= t;
    return t - since < PENDING_POLL_MAX_MS ? PENDING_POLL_MS : false;
  };
}
