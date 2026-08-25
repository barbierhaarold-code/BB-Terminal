import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { fetchHLFundingHistory } from "./hyperliquid";
import { Loading, ErrorBlock, EmptyBlock } from "@/functions/research/shared";

type Window = "6h" | "24h";
const WINDOW_MS: Record<Window, number> = { "6h": 6 * 3600_000, "24h": 24 * 3600_000 };

/**
 * Mark-vs-oracle premium over time, in basis points. Hyperliquid doesn't
 * expose a raw historical oraclePx/markPx series via REST — `fundingHistory`
 * is the real hourly record of exactly that spread (it's what funding
 * payments are computed from), so it's used directly rather than trying to
 * reconstruct two near-identical absolute price lines from snapshots.
 */
export function PremiumChart({ coins, defaultCoin }: { coins: string[]; defaultCoin: string }) {
  const [coin, setCoin] = useState(defaultCoin);
  const [win, setWin] = useState<Window>("24h");

  const { data, isLoading, error } = useQuery({
    queryKey: ["hl-premium", coin, win],
    queryFn: () => fetchHLFundingHistory(coin, Date.now() - WINDOW_MS[win]),
    staleTime: 5 * 60_000,
  });

  const points = data ?? [];
  const bps = points.map((p) => p.premium * 10_000);
  const last = bps.length > 0 ? bps[bps.length - 1] : undefined;
  const min = bps.length > 0 ? Math.min(...bps, 0) : 0;
  const max = bps.length > 0 ? Math.max(...bps, 0) : 0;

  const path = useMemo(() => {
    if (bps.length < 2) return "";
    const range = max - min || 1;
    const stepX = 100 / (bps.length - 1);
    return bps.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${(100 - ((v - min) / range) * 100).toFixed(2)}`).join(" ");
  }, [bps, min, max]);

  const zeroY = useMemo(() => {
    const range = max - min || 1;
    return 100 - ((0 - min) / range) * 100;
  }, [min, max]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={coin}
          onChange={(e) => setCoin(e.target.value)}
          className="bg-term-panel2 border border-term-border px-2 py-1 text-[11px] uppercase outline-none focus:border-term-amber"
        >
          {coins.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex gap-1">
          {(["6h", "24h"] as Window[]).map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={cn(
                "px-2 py-0.5 border text-[11px] uppercase",
                win === w ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text"
              )}
            >
              {w}
            </button>
          ))}
        </div>
        {last !== undefined && (
          <span className="sub-header ml-auto">
            CURRENT PREMIUM: <span className={cn("num", last >= 0 ? "up" : "down")}>{last >= 0 ? "+" : ""}{last.toFixed(2)} bps</span>
          </span>
        )}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBlock err={error as Error} /> : bps.length < 2 ? (
        <EmptyBlock>No funding history returned for {coin} over the last {win}.</EmptyBlock>
      ) : (
        <div className="border border-term-border p-3">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-32">
            <line x1="0" y1={zeroY} x2="100" y2={zeroY} className="stroke-term-border" strokeWidth="0.5" strokeDasharray="1.5,1.5" />
            <path d={path} fill="none" className={cn(last !== undefined && last >= 0 ? "stroke-term-green" : "stroke-term-red")} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="flex justify-between text-[10px] text-term-muted mt-1">
            <span>{new Date(points[0].time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            <span>max {max.toFixed(2)} bps · min {min.toFixed(2)} bps</span>
            <span>{new Date(points[points.length - 1].time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
