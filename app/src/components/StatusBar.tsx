import { useEffect, useState } from "react";
import { useWorkspace } from "@/store/workspaceStore";

export function StatusBar() {
  const [now, setNow] = useState(() => new Date());
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const tabs = useWorkspace((s) => s.tabs);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch("/api/v1/equity/price/quote?symbol=SPY&provider=yfinance");
        if (alive) setApiOk(r.ok);
      } catch { if (alive) setApiOk(false); }
    };
    ping();
    const t = setInterval(ping, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="h-6 px-3 flex items-center justify-between border-t border-term-border bg-term-panel2 text-[10px] uppercase tracking-[0.18em] text-term-muted">
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-2">
          <span className={
            apiOk == null ? "w-1.5 h-1.5 bg-term-muted"
            : apiOk ? "w-1.5 h-1.5 bg-term-green shadow-[0_0_6px_rgba(34,238,34,0.6)]"
            : "w-1.5 h-1.5 bg-term-red shadow-[0_0_6px_rgba(255,59,59,0.6)]"
          } />
          <span>OPENBB {apiOk == null ? "…" : apiOk ? "LIVE" : "DOWN"}</span>
        </span>
        <span className="hidden sm:inline">PROVIDER <span className="text-term-amber ml-1">YFINANCE</span></span>
        <span className="hidden sm:inline">TABS <span className="text-term-text ml-1 num">{tabs.length}</span></span>
      </div>
      <div className="flex items-center gap-5 num">
        <span className="hidden sm:inline">{now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })}</span>
        <span className="text-term-amber">{now.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
