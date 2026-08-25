import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtPrice, fmtVolume } from "@/lib/format";
import { useBinanceLiquidations } from "./useBinanceLiquidations";
import { SectionTitle, GapNotice } from "@/functions/research/shared";

const THRESHOLDS = [0, 10_000, 50_000] as const;
const timeOfDay = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Simple horizontal notional-by-symbol heatmap over the buffered events. */
function Heatmap({ events }: { events: { symbol: string; notional: number; side: "BUY" | "SELL" }[] }) {
  const bySymbol = useMemo(() => {
    const m = new Map<string, { long: number; short: number }>();
    for (const e of events) {
      const cur = m.get(e.symbol) ?? { long: 0, short: 0 };
      // A SELL force-order liquidates a long position; a BUY force-order liquidates a short.
      if (e.side === "SELL") cur.long += e.notional; else cur.short += e.notional;
      m.set(e.symbol, cur);
    }
    return [...m.entries()]
      .map(([symbol, v]) => ({ symbol, ...v, total: v.long + v.short }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [events]);

  if (bySymbol.length === 0) return null;
  const max = Math.max(...bySymbol.map((r) => r.total), 1);

  return (
    <div className="flex flex-col gap-1.5">
      {bySymbol.map((r) => (
        <div key={r.symbol} className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-term-amberBright">{r.symbol.replace("USDT", "")}</span>
          <div className="relative flex-1 h-3.5 bg-term-panel2 border border-term-border overflow-hidden flex">
            <div className="h-full bg-term-red/70" style={{ width: `${(r.long / max) * 100}%` }} title={`Longs liquidated: $${fmtVolume(r.long)}`} />
            <div className="h-full bg-term-green/70" style={{ width: `${(r.short / max) * 100}%` }} title={`Shorts liquidated: $${fmtVolume(r.short)}`} />
          </div>
          <span className="num w-20 text-right text-term-muted shrink-0">${fmtVolume(r.total)}</span>
        </div>
      ))}
    </div>
  );
}

export function LiquidationsPanel() {
  const { events, status } = useBinanceLiquidations();
  const [minNotional, setMinNotional] = useState<number>(THRESHOLDS[0]);
  const rows = useMemo(() => events.filter((e) => e.notional >= minNotional), [events, minNotional]);

  return (
    <div className="p-4 flex flex-col gap-4 text-[12px]">
      <div>
        <SectionTitle>LIQUIDATIONS — BINANCE FUTURES, LIVE</SectionTitle>
        <GapNotice>
          Binance's public liquidation feed is a live websocket only (<code>!forceOrder@arr</code>) — there's no free
          REST endpoint for liquidation history, so this table only fills as events happen after the tab connects. It
          is not pre-populated with anything from before that.
        </GapNotice>
      </div>

      <div>
        <div className="sub-header mb-1.5">NOTIONAL LIQUIDATED BY SYMBOL — RED = LONGS, GREEN = SHORTS</div>
        {rows.length === 0 ? (
          <div className="text-term-muted text-[11px] uppercase tracking-widest py-2">Waiting for events…</div>
        ) : (
          <Heatmap events={rows} />
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            status === "open" ? "bg-term-green animate-pulse" : status === "connecting" ? "bg-term-amber" : "bg-term-red"
          )}
        />
        <span className="sub-header">
          {status === "open" ? "LIVE" : status === "connecting" ? "CONNECTING…" : "RECONNECTING…"} — BINANCE FORCE-ORDER WS
        </span>
        <div className="w-px h-4 bg-term-border mx-1" />
        {THRESHOLDS.map((t) => (
          <button
            key={t}
            onClick={() => setMinNotional(t)}
            className={cn(
              "px-2 py-0.5 border text-[11px] uppercase",
              minNotional === t ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text"
            )}
          >
            {t === 0 ? "All" : `$${fmtVolume(t)}+`}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-term-muted text-[11px] uppercase tracking-widest py-6 text-center">
          {status === "open" ? "No liquidation events yet at this threshold…" : "Connecting to Binance…"}
        </div>
      ) : (
        <div className="border border-term-border overflow-auto scroll-thin max-h-[45vh]">
          <table className="w-full grid-data">
            <thead>
              <tr>
                <th>Time</th><th>Symbol</th><th>Side Liquidated</th>
                <th className="text-right">Price</th><th className="text-right">Qty</th><th className="text-right">Notional</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="num text-term-muted">{timeOfDay(e.time)}</td>
                  <td className="text-term-amberBright">{e.symbol.replace("USDT", "")}</td>
                  <td className={cn(e.side === "SELL" ? "down" : "up")}>{e.side === "SELL" ? "Long" : "Short"}</td>
                  <td className="num text-right">{fmtPrice(e.price, e.price < 1 ? 4 : 2)}</td>
                  <td className="num text-right text-term-muted">{e.qty}</td>
                  <td className="num text-right">${fmtVolume(e.notional)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
