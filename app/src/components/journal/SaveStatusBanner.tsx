import { RefreshCw } from "lucide-react";
import { isServerMode } from "@/lib/userData/backend";
import { dismissSaveError, retrySave, useSync } from "@/lib/userData/sync";

/**
 * Server mode only. Three things, never silent:
 *  - offline  → plainly read-only;
 *  - saving   → a quiet "Saving…" while writes are in flight;
 *  - failed   → the real reason, what was rolled back, with Retry / Dismiss.
 */
export function SaveStatusBanner() {
  const { pending, saveError, offline } = useSync();
  if (!isServerMode()) return null;
  return (
    <>
      {offline && (
        <div role="status" data-testid="offline-banner" className="px-3 py-2 border border-term-amber/60 text-term-amber text-[11px]">
          <b className="uppercase tracking-wider mr-2">Offline — read-only</b>
          You can read what is already loaded, but nothing can be saved until the connection is back.
        </div>
      )}
      {saveError && (
        <div role="alert" data-testid="save-error" className="px-3 py-2 border border-term-red/60 text-term-red text-[11px] flex items-start gap-3">
          <div className="flex-1 min-w-0"><b className="uppercase tracking-wider mr-2">Not saved</b>{saveError.message}</div>
          <div className="flex gap-2 shrink-0">
            {saveError.ops.length > 0 && (
              <button onClick={retrySave} className="px-2 py-1 border border-term-red/60 uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
                <RefreshCw size={11} /> Retry
              </button>
            )}
            <button onClick={dismissSaveError} className="px-2 py-1 border border-term-border text-term-muted uppercase tracking-wider hover:text-term-text">Dismiss</button>
          </div>
        </div>
      )}
      {pending > 0 && !saveError && (
        <div role="status" className="text-term-muted text-[11px] uppercase tracking-widest" data-testid="saving">Saving…</div>
      )}
    </>
  );
}
