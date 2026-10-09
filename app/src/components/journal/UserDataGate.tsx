import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { isServerMode } from "@/lib/userData/backend";
import { SaveStatusBanner } from "./SaveStatusBanner";

/**
 * The 3-state rule for account-backed data: loading / error (real cause + Retry) / content.
 * "Empty" is each screen's own empty state once `ready`. In local mode this is a pass-through.
 */
export function UserDataGate({ children }: { children: ReactNode }) {
  const jStatus = useJournal((s) => s.status);
  const jError = useJournal((s) => s.loadError);
  const reload = useJournal((s) => s.reload);
  const pStatus = useTradePlans((s) => s.status);
  const pError = useTradePlans((s) => s.loadError);
  if (!isServerMode()) return <>{children}</>;

  const status = jStatus === "error" || pStatus === "error" ? "error"
    : jStatus === "ready" && pStatus === "ready" ? "ready" : "loading";

  return (
    <>
      <div className="px-3 pt-3 flex flex-col gap-2 empty:hidden"><SaveStatusBanner /></div>
      {status === "loading" && (
        <div className="p-6 text-term-muted text-[11px] uppercase tracking-[0.2em]" data-testid="userdata-loading">Loading your journal<span className="caret" /></div>
      )}
      {status === "error" && (
        <div role="alert" data-testid="userdata-error" className="m-3 p-3 text-term-red flex flex-col items-start gap-2 border border-term-red/40 text-[12px]">
          <div><span className="sub-header text-term-red mr-1">ERROR</span>Your journal could not be loaded: {jError ?? pError}. Nothing was changed.</div>
          <button onClick={reload} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}
      {status === "ready" && children}
    </>
  );
}
