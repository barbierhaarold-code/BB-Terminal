import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSpotSeries, SPOT_GOLD_SYMBOL } from "@/lib/api";
import { atr, spotQueryOptions, dataAgeMs, isStale, fmtAge } from "@/lib/forex";
import { fmtPrice, fmtPct } from "@/lib/format";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";

const ATR_TF = [
  { label: "5M", interval: "5min" },
  { label: "15M", interval: "15min" },
  { label: "1H", interval: "1h" },
];

export function XauScalper({ onHeaderClick }: { onHeaderClick?: () => void }) {
  const [tf, setTf] = useState(ATR_TF[0]);
  const openTab = useWorkspace((s) => s.openTab);

  // Real spot XAU/USD (Twelve Data) — last/high/low/open/prevClose come
  // straight off its quote endpoint, no candle-derivation needed. This is
  // the same instrument GP's TradingView chart shows (OANDA:XAUUSD), so the
  // big number here now matches the chart instead of trailing it via GC=F's
  // futures basis premium.
  const price = useQuery(spotQueryOptions(SPOT_GOLD_SYMBOL));
  // Separate series for ATR on the selected timeframe.
  const atrQ = useQuery({
    queryKey: ["xau-atr", tf.interval],
    queryFn: () => fetchSpotSeries(SPOT_GOLD_SYMBOL, tf.interval),
    refetchInterval: 5 * 60_000,
  });

  const last = price.data?.last, open = price.data?.open, high = price.data?.high, low = price.data?.low, prev = price.data?.prevClose;

  const chg = last != null && prev != null ? last - prev : undefined;
  const chgPct = chg != null && prev ? (chg / prev) * 100 : undefined;
  const dir = chg == null ? "flat" : chg >= 0 ? "up" : "down";
  const fromOpen = last != null && open != null ? last - open : undefined;
  const a = atrQ.data ? atr(atrQ.data, 14) : undefined;

  const asOf = price.data?.asOf;
  const lastCandle = asOf ? asOf.slice(11, 16) : undefined;
  const age = dataAgeMs(asOf);
  const stale = isStale(asOf, "spot");

  // position of `last` within the day range (guaranteed 0–100 since last ∈ [low,high])
  const rangePct = last != null && high != null && low != null && high > low
    ? ((last - low) / (high - low)) * 100 : undefined;

  return (
    <div className="panel h-full">
      <div className="panel-header cursor-pointer" onClick={onHeaderClick ?? (() => openTab("GP", "GC=F"))}>
        <span className="text-term-amberBright">GOLD · SCALPER</span>
        <span className="sub-header normal-case tracking-normal font-normal">
          XAU/USD SPOT — TWELVE DATA
        </span>
      </div>

      {price.error && !price.data ? (
        <div className="p-4 text-term-red text-[12px]">{(price.error as Error).message}</div>
      ) : (
        <div className="p-3 flex flex-col gap-3">
          {/* Big live number */}
          <div className="flex items-end justify-between">
            <div>
              <div className={cn("num font-bold leading-none text-[40px]", dir === "up" && "up", dir === "down" && "down")}>
                {price.isLoading && !price.data ? "…" : last != null ? fmtPrice(last, 2) : "—"}
              </div>
              <div className={cn("num text-[13px] mt-1", dir === "up" && "up", dir === "down" && "down")}>
                {chg == null ? "" : (chg >= 0 ? "+" : "") + fmtPrice(chg, 2)}
                <span className="ml-2">({fmtPct(chgPct)})</span>
              </div>
            </div>
            <div className="text-right">
              <div className="sub-header">FROM OPEN</div>
              <div className={cn("num text-[15px]",
                fromOpen == null ? "" : fromOpen >= 0 ? "up" : "down")}>
                {fromOpen == null ? "—" : `${fromOpen >= 0 ? "+" : ""}${fromOpen.toFixed(2)}`}
              </div>
            </div>
          </div>

          {/* Day range bar */}
          <div>
            <div className="flex justify-between text-[11px] num mb-1">
              <span className="down">L {low != null ? fmtPrice(low, 2) : "—"}</span>
              <span className="sub-header">DAY RANGE</span>
              <span className="up">H {high != null ? fmtPrice(high, 2) : "—"}</span>
            </div>
            <div className="relative h-1.5 bg-term-panel2 border border-term-border">
              {rangePct != null && (
                <div className="absolute -top-[3px] w-[3px] h-[9px] bg-term-amber shadow-[0_0_5px_rgba(180,92,255,0.8)]"
                  style={{ left: `calc(${Math.max(0, Math.min(100, rangePct))}% - 1px)` }} />
              )}
            </div>
          </div>

          {/* ATR + timeframe */}
          <div className="flex items-center justify-between border-t border-term-borderSoft pt-2">
            <div className="flex items-baseline gap-2">
              <span className="sub-header">ATR(14)</span>
              <span className="num text-[16px] text-term-heading">{a != null ? a.toFixed(2) : "—"}</span>
              <span className="sub-header normal-case tracking-normal">{tf.label} bars</span>
            </div>
            <div className="flex gap-1">
              {ATR_TF.map((t) => (
                <button key={t.label} onClick={() => setTf(t)}
                  className={cn("px-1.5 py-0.5 text-[10px] border tracking-wider",
                    t.label === tf.label ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className={cn("sub-header flex items-center gap-2", stale && "text-term-red")}>
            {stale && (
              <span className="inline-flex items-center gap-1 px-1 py-0.5 border border-term-red text-term-red normal-case tracking-normal font-bold">
                ⚠ STALE — {age != null ? fmtAge(age) : "?"} OLD
              </span>
            )}
            <span>{lastCandle ? `LAST QUOTE ${lastCandle} UTC · 20S POLL` : "LIVE · TWELVE DATA · 20S POLL"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
