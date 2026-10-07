import { Lock, Mail } from "lucide-react";
import { FEATURE_LOCK_COPY, buildAccessMailtoHref, type LockableFeature } from "@/lib/featureLock";
import { cn } from "@/lib/cn";

/**
 * Full-panel "premium teaser" shown when the server returns 403 feature_locked.
 * Reused by every lockable feature (Copilot, Tweets, Vessels) so a future locked
 * module only needs to add its copy to FEATURE_LOCK_COPY. Deliberate locked state
 * — never an error. Allowed users never see it (the lock flag is only set on a
 * real 403 from the server).
 */
export function LockedFeature({ feature, className }: { feature: LockableFeature; className?: string }) {
  const copy = FEATURE_LOCK_COPY[feature];
  return (
    <div className={cn("h-full w-full overflow-auto scroll-thin flex items-center justify-center p-6", className)}>
      <div className="w-full max-w-md flex flex-col items-center text-center gap-4">
        <div className="w-12 h-12 flex items-center justify-center rounded-full border border-term-amberDim bg-term-amberSubtle shadow-[0_0_24px_-6px_rgba(180,92,255,0.5)]">
          <Lock size={20} className="text-term-amber" />
        </div>

        <div className="text-[9px] uppercase tracking-[0.3em] text-term-amber/70">Members only</div>

        <h2 className="text-term-heading text-[15px] leading-snug font-bold">{copy.headline}</h2>

        <p className="text-term-text text-[12px] leading-relaxed">{copy.body}</p>

        <p className="w-full border-t border-term-borderSoft pt-3 text-term-muted text-[11px] leading-relaxed italic">
          {copy.reason}
        </p>

        <a
          href={buildAccessMailtoHref(feature)}
          className="mt-1 inline-flex items-center gap-2 border border-term-amber bg-term-amberSubtle px-4 py-2 text-[12px] uppercase tracking-wider text-term-amberBright hover:bg-term-amber hover:text-term-bg transition-colors"
        >
          <Mail size={13} />
          {copy.button}
        </a>
      </div>
    </div>
  );
}
