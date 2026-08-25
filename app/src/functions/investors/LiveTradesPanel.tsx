import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtVolume, fmtPrice } from "@/lib/format";
import { type HLTrade, type WsStatus } from "./useHyperliquidTrades";

const THRESHOLDS = [10_000, 50_000, 250_000] as const;

const HL_EXPLORER = "https://app.hyperliquid.xyz/explorer";
const truncAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const timeOfDay = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LiveTradesPanel({ trades, status }: { trades: HLTrade[]; status: WsStatus }) {
  const [minNotional, setMinNotional] = useState<number>(THRESHOLDS[0]);
  const rows = useMemo(() => trades.filter((t) => t.notional >= minNotional), [trades, minNotional]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            status === "open" ? "bg-term-green animate-pulse" : status === "connecting" ? "bg-term-amber" : "bg-term-red"
          )}
        />
        <span className="sub-header">
          {status === "open" ? "LIVE" : status === "connecting" ? "CONNECTING…" : "RECONNECTING…"} — HYPERLIQUID PUBLIC TRADES WS
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
            ${fmtVolume(t)}+
          </button>
        ))}
        <button
          disabled
          title="Not exposed by Hyperliquid's public API — the trades feed carries no liquidation flag, and a market-wide liquidation stream isn't documented (only per-account, which needs a wallet you're already watching)."
          className="px-2 py-0.5 border border-term-borderSoft text-term-muted/50 text-[11px] uppercase cursor-not-allowed"
        >
          Liquidations — n/a
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-term-muted text-[11px] uppercase tracking-widest py-6 text-center">
          {status === "open" ? `Waiting for a trade ≥ $${fmtVolume(minNotional)}…` : "Connecting to Hyperliquid…"}
        </div>
      ) : (
        <div className="border border-term-border overflow-auto scroll-thin max-h-[50vh]">
          <table className="w-full grid-data">
            <thead>
              <tr>
                <th>Time</th><th>Asset</th><th>Side</th>
                <th className="text-right">Price</th><th className="text-right">Size</th><th className="text-right">Notional</th>
                <th>Buyer</th><th>Seller</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.tid}>
                  <td className="num text-term-muted">{timeOfDay(t.time)}</td>
                  <td className="text-term-amberBright">{t.coin}</td>
                  <td className={cn(t.side === "B" ? "up" : "down")}>{t.side === "B" ? "Buy" : "Sell"}</td>
                  <td className="num text-right">{fmtPrice(t.px, t.px < 1 ? 4 : 2)}</td>
                  <td className="num text-right text-term-muted">{t.sz}</td>
                  <td className="num text-right">${fmtVolume(t.notional)}</td>
                  <td>
                    <a href={`${HL_EXPLORER}/address/${t.buyer}`} target="_blank" rel="noreferrer" className="text-term-cyan hover:underline num">
                      {truncAddr(t.buyer)}
                    </a>
                  </td>
                  <td>
                    <a href={`${HL_EXPLORER}/address/${t.seller}`} target="_blank" rel="noreferrer" className="text-term-cyan hover:underline num">
                      {truncAddr(t.seller)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
