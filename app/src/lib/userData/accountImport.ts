// The single place that writes imported data into the signed-in account
// (Backup → Import JSON → Merge, and "Import my local journal into this account").
// Goes through the adapter — never through store.setState, which would not persist.
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import type { ImportBatch } from "./adapter";
import { isServerMode } from "./backend";
import { runImport, type ImportReport } from "./importPlan";
import { currentUserId, getAdapter } from "./runtime";
import { applyLoadedSnapshot } from "./session";
import { useSync } from "./sync";

/** Why an import into the account cannot start right now, or null. */
export function importBlockedReason(): string | null {
  if (!isServerMode()) return "Account import is only available when journal data is stored on the server.";
  const uid = currentUserId();
  const j = useJournal.getState(), p = useTradePlans.getState();
  if (!uid) return "You are not signed in.";
  if (j.status !== "ready" || p.status !== "ready" || j.ownerId !== uid || p.ownerId !== uid) return "Your journal is not loaded yet.";
  const sync = useSync.getState();
  if (sync.offline) return "You are offline — import is unavailable (read-only).";
  if (sync.pending > 0) return "Changes are still being saved — wait a moment and try again.";
  return null;
}

/**
 * Idempotent: rows already in the account (by id, or same fill) are skipped, never overwritten.
 * Re-reads the account afterwards and returns the count/net-P&L check; the stores are refreshed from that re-read.
 * `copyBaseCapital` is applied only if the account has none.
 */
export async function importIntoAccount(batch: ImportBatch, opts: { copyBaseCapital?: number | null } = {}): Promise<ImportReport> {
  const blocked = importBlockedReason();
  if (blocked) throw new Error(blocked);
  const uid = currentUserId()!;
  const report = await runImport(getAdapter(), batch, opts);
  applyLoadedSnapshot(uid, report.after);
  return report;
}
