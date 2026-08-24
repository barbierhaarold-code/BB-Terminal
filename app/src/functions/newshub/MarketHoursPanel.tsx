import { useEffect, useState } from "react";
import { EXCHANGES, exchangeStatus, type ExchangePhase } from "@/lib/marketHours";
import { fmtCountdown } from "@/lib/forex";
import { cn } from "@/lib/cn";

const PHASE_LABEL: Record<ExchangePhase, string> = {
  pre: "PRE-MARKET", open: "OPEN", after: "AFTER-HOURS", closed: "CLOSED",
};
const PHASE_NEXT_LABEL: Record<ExchangePhase, string> = {
  pre: "opens ", open: "closes ", after: "closes ", closed: "opens ",
};

export function MarketHoursPanel() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const statuses = EXCHANGES.map((def) => exchangeStatus(def, now));

  return (
    <div className="h-full overflow-auto scroll-thin p-3">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 text-[11px]">
        {statuses.map((s) => (
          <div
            key={s.def.name}
            className={cn(
              "border p-2.5 flex flex-col gap-1",
              s.phase === "open" ? "border-term-green/60 bg-term-green/5"
                : s.phase === "pre" || s.phase === "after" ? "border-term-amber/50 bg-term-amberSubtle"
                : "border-term-border"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span>{s.def.flag}</span>
                <span className="text-term-heading font-bold tracking-wider">{s.def.name}</span>
              </span>
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  s.phase === "open" ? "bg-term-green shadow-[0_0_6px_rgba(34,238,34,0.7)]"
                    : s.phase === "pre" || s.phase === "after" ? "bg-term-amber"
                    : "bg-term-muted"
                )}
              />
            </div>
            <div className="num text-term-text">{s.localTime} local</div>
            <div
              className={cn(
                "num text-[10px] font-bold tracking-wider",
                s.phase === "open" ? "up" : s.phase === "pre" || s.phase === "after" ? "text-term-amberBright" : "text-term-muted"
              )}
            >
              {PHASE_LABEL[s.phase]}
            </div>
            <div className="sub-header normal-case tracking-normal">
              {PHASE_NEXT_LABEL[s.phase]}{fmtCountdown(s.msToNext)}
            </div>
          </div>
        ))}
      </div>
      <div className="sub-header mt-3">
        PURE TIMEZONE MATH · NO HOLIDAY CALENDAR — A MARKET HOLIDAY WILL STILL SHOW AS "SHOULD BE OPEN"
      </div>
    </div>
  );
}
