import { useEffect, useState } from "react";
import {
  SESSIONS, sessionStatus, overlaps, sessionUtcBands, utcNowHour, fmtCountdown,
} from "@/lib/forex";
import { cn } from "@/lib/cn";

const BAND_COLORS: Record<string, string> = {
  Sydney: "rgba(34,204,238,0.55)",
  Tokyo: "rgba(34,238,34,0.5)",
  London: "rgba(180,92,255,0.6)",
  "New York": "rgba(205,147,255,0.6)",
};

export function SessionsClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const statuses = SESSIONS.map((s) => sessionStatus(s, now));
  const ov = overlaps(now);
  const nowHour = utcNowHour(now);

  return (
    <div className="panel">
      <div className="panel-header">
        <span>FOREX SESSIONS</span>
        <span className="sub-header normal-case tracking-normal font-normal">
          {now.toUTCString().slice(17, 22)} UTC
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Session status row */}
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          {statuses.map((s) => (
            <div key={s.def.name}
              className={cn("border p-2 flex flex-col gap-0.5",
                s.open ? "border-term-green/60 bg-term-green/5" : "border-term-border")}>
              <div className="flex items-center justify-between">
                <span className="text-term-heading font-bold tracking-wider">{s.def.short}</span>
                <span className={cn("w-1.5 h-1.5 rounded-full",
                  s.open ? "bg-term-green shadow-[0_0_6px_rgba(34,238,34,0.7)]" : "bg-term-muted")} />
              </div>
              <div className="num text-term-text">{s.localTime}</div>
              <div className={cn("num text-[10px]", s.open ? "up" : "text-term-muted")}>
                {s.open ? "OPEN" : "CLOSED"}
              </div>
              <div className="sub-header normal-case tracking-normal">
                {s.open ? "closes " : "opens "}{fmtCountdown(s.msToNext)}
              </div>
            </div>
          ))}
        </div>

        {/* 24h UTC timeline with session bands + overlap shading */}
        <div>
          <div className="relative h-16 border border-term-border bg-term-bg2">
            {/* hour gridlines */}
            {[0, 6, 12, 18, 24].map((h) => (
              <div key={h} className="absolute top-0 bottom-0 border-l border-term-borderSoft"
                style={{ left: `${(h / 24) * 100}%` }} />
            ))}
            {/* session bands, one row each */}
            {SESSIONS.map((def, i) => (
              <div key={def.name} className="absolute left-0 right-0" style={{ top: 4 + i * 13, height: 10 }}>
                {sessionUtcBands(def, now).map((seg, k) => (
                  <div key={k} className="absolute top-0 h-full rounded-sm"
                    style={{
                      left: `${(seg[0] / 24) * 100}%`,
                      width: `${((seg[1] - seg[0]) / 24) * 100}%`,
                      background: BAND_COLORS[def.name],
                    }}
                    title={def.name} />
                ))}
                <span className="absolute -top-0.5 left-1 text-[9px] text-term-heading/80 font-bold pointer-events-none">
                  {def.short}
                </span>
              </div>
            ))}
            {/* now marker */}
            <div className="absolute top-0 bottom-0 w-px bg-term-amber shadow-[0_0_6px_rgba(180,92,255,0.8)] z-10"
              style={{ left: `${(nowHour / 24) * 100}%` }}>
              <div className="absolute -top-0.5 -left-[3px] w-[7px] h-[7px] rotate-45 bg-term-amber" />
            </div>
          </div>
          <div className="flex justify-between sub-header normal-case tracking-normal mt-0.5">
            <span>00</span><span>06</span><span>12 UTC</span><span>18</span><span>24</span>
          </div>
        </div>

        {/* Overlap badges */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {ov.map((o) => (
            <div key={o.label}
              className={cn("border px-2 py-1.5 flex items-center justify-between",
                o.active ? "border-term-amber bg-term-amberSubtle" : "border-term-border")}>
              <span className={cn("tracking-wider", o.active ? "text-term-amberBright font-bold" : "text-term-muted")}>
                {o.label}
              </span>
              <span className={cn("text-[10px] uppercase tracking-widest",
                o.active ? "up" : "text-term-muted")}>
                {o.active ? "● LIVE" : "idle"}
              </span>
            </div>
          ))}
        </div>
        <div className="sub-header">HIGH-LIQUIDITY OVERLAP WINDOWS · LOCAL 8–5 CONVENTION</div>
      </div>
    </div>
  );
}
