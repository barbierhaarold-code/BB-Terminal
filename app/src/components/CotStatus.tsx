import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { cotFreshness, freshnessLine, lateMessage, type CotSnapshot } from "@/lib/cot";

/**
 * The one place COT freshness + provenance is worded, used by every COT consumer
 * (COT page, Gold Intelligence, Quant). Never presents Tuesday data as live:
 * always "positions as of <Tuesday> · published <Friday>", flags a late report,
 * and shouts when the Tradingster fallback or a stale cache is in use.
 */
export function CotStatus({ snap, compact = false, className }: { snap: CotSnapshot; compact?: boolean; className?: string }) {
  const f = cotFreshness(snap);
  const fallback = snap.source !== "cftc";
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]">
        {f && <span className="num text-term-text" data-testid="cot-freshness">{freshnessLine(f)}</span>}
        <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 border",
          fallback ? "border-term-red text-term-red" : "border-term-borderSoft text-term-muted")}>
          {fallback ? "FALLBACK SOURCE" : snap.sourceLabel}
        </span>
        {!compact && f && (
          <span className="text-term-muted">
            Next: positions as of {f.nextAsOf.slice(5).replace("-", "/")} · scheduled {new Date(f.nextReleaseAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET
          </span>
        )}
      </div>
      {f?.late && (
        <Banner tone="amber" testid="cot-late">{lateMessage(f)}</Banner>
      )}
      {snap.stale && !fallback && (
        <Banner tone="amber" testid="cot-stale">{snap.warnings[0]}</Banner>
      )}
      {fallback && (
        <Banner tone="red" testid="cot-fallback">{snap.sourceLabel}. {snap.warnings[0]}</Banner>
      )}
    </div>
  );
}

function Banner({ tone, children, testid }: { tone: "amber" | "red"; children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className={cn("flex items-start gap-2 border px-2 py-1 text-[11px] leading-snug",
      tone === "red" ? "border-term-red/60 text-term-red bg-term-red/5" : "border-term-amber/60 text-term-text bg-term-amberSubtle")}>
      <AlertTriangle size={12} className={cn("mt-0.5 shrink-0", tone === "red" ? "text-term-red" : "text-term-amber")} />
      <span>{children}</span>
    </div>
  );
}

/** Shared 3-state helpers so every COT consumer renders loading / error+Retry the same way. */
export function CotLoading({ what = "COT report" }: { what?: string }) {
  return <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]">Loading {what}…</div>;
}

export function CotError({ error, onRetry, fetching }: { error: unknown; onRetry: () => void; fetching?: boolean }) {
  return (
    <div className="p-3 text-term-red flex flex-col items-start gap-2 text-[12px]" role="alert">
      <div><span className="sub-header text-term-red mr-1">ERROR</span>{(error as Error)?.message ?? "COT report unavailable."}</div>
      <button onClick={onRetry}
        className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
        <RefreshCw size={11} className={cn(fetching && "animate-spin")} /> Retry
      </button>
    </div>
  );
}
