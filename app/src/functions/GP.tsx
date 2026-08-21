import { useEffect, useMemo, useRef, useState } from "react";
import { loadTradingViewScript, toTradingViewSymbol } from "@/lib/tradingview";
import { cn } from "@/lib/cn";

export function GP({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = useMemo(() => toTradingViewSymbol(symbol), [symbol]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setStatus("loading");
    container.innerHTML = "";
    const mount = document.createElement("div");
    mount.id = `tv-widget-${Math.random().toString(36).slice(2)}`;
    mount.style.height = "100%";
    mount.style.width = "100%";
    container.appendChild(mount);

    let cancelled = false;
    loadTradingViewScript()
      .then(() => {
        if (cancelled || !window.TradingView) return;
        new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: "D",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0a0a0a",
          enable_publishing: false,
          allow_symbol_change: true,
          withdateranges: true,
          hide_side_toolbar: false,
          container_id: mount.id,
        });
        if (!cancelled) setStatus("ready");
      })
      .catch(() => { if (!cancelled) setStatus("error"); });

    return () => { cancelled = true; };
  }, [tvSymbol]);

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" && <Centered>LOADING CHART…</Centered>}
      {status === "error" && <Centered error>Failed to load the TradingView widget.</Centered>}
    </div>
  );
}

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={cn(
      "absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-widest pointer-events-none",
      error ? "text-term-red" : "text-term-muted"
    )}>
      {children}
    </div>
  );
}
