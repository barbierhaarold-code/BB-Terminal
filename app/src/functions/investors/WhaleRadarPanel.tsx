import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionTitle, GapNotice, Loading, ErrorBlock } from "@/functions/research/shared";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { fetchHLPerps, pickTradeFeedCoins, VERIFIED_REAL_WORLD_MARKETS } from "./hyperliquid";
import { useHyperliquidTrades } from "./useHyperliquidTrades";
import { LiveTradesPanel } from "./LiveTradesPanel";
import { PremiumChart } from "./PremiumChart";

export function WhaleRadarPanel() {
  const perpsQ = useQuery({ queryKey: ["hl-perps"], queryFn: fetchHLPerps, staleTime: 30_000, refetchInterval: 30_000 });
  const perps = perpsQ.data ?? [];

  const tradeFeedCoins = useMemo(() => pickTradeFeedCoins(perps), [perps]);
  const { trades, status } = useHyperliquidTrades(tradeFeedCoins);

  const chartCoins = useMemo(() => {
    const top = [...perps].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm).slice(0, 10).map((p) => p.coin);
    const set = new Set(top);
    for (const m of VERIFIED_REAL_WORLD_MARKETS) set.add(m.coin);
    return Array.from(set);
  }, [perps]);

  const gold = perps.find((p) => p.coin === "PAXG");
  const goldChangePct = gold && gold.prevDayPx > 0 ? ((gold.oraclePx - gold.prevDayPx) / gold.prevDayPx) * 100 : undefined;

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px]">
      <div>
        <SectionTitle>WHALE RADAR — HYPERLIQUID, LIVE</SectionTitle>
        <div className="sub-header">
          PUBLIC HYPERLIQUID API · NO KEY · SEE CORRECTIONS TO THE ORIGINAL RESEARCH SPIKE BELOW
        </div>
      </div>

      <div>
        <SectionTitle>LIVE TRADE FEED — NOTABLE PRINTS ACROSS TOP-VOLUME PERPS</SectionTitle>
        {perpsQ.isLoading ? <Loading /> : perpsQ.error ? <ErrorBlock err={perpsQ.error as Error} /> : (
          <LiveTradesPanel trades={trades} status={status} />
        )}
      </div>

      <div>
        <SectionTitle>24/7 REAL-WORLD-ASSET MARKET — GOLD</SectionTitle>
        {perpsQ.isLoading ? <Loading /> : !gold ? (
          <GapNotice>PAXG perp not returned by Hyperliquid right now — see the correction below for why nothing else qualifies here.</GapNotice>
        ) : (
          <div className="flex items-baseline gap-6 border border-term-border px-4 py-3 max-w-md">
            <div>
              <div className="sub-header">PAXG (PAXOS GOLD) · ORACLE PRICE</div>
              <div className="num text-[20px] text-term-heading">${fmtPrice(gold.oraclePx)}</div>
            </div>
            {goldChangePct !== undefined && (
              <div>
                <div className="sub-header">24H</div>
                <div className={cn("num text-[16px]", goldChangePct >= 0 ? "up" : "down")}>
                  {goldChangePct >= 0 ? "+" : ""}{fmtPct(goldChangePct)}
                </div>
              </div>
            )}
            <div>
              <div className="sub-header">MARK/ORACLE PREMIUM</div>
              <div className="num text-[13px] text-term-text">{(gold.premium * 10_000).toFixed(2)} bps</div>
            </div>
          </div>
        )}
      </div>

      {chartCoins.length > 0 && (
        <div>
          <SectionTitle>MARK / ORACLE PREMIUM</SectionTitle>
          <PremiumChart coins={chartCoins} defaultCoin={chartCoins[0]} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-term-red text-[11px] tracking-widest font-bold">CORRECTION TO THE ORIGINAL RESEARCH SPIKE</div>
        <p className="text-term-text leading-relaxed">
          The first pass flagged Hyperliquid spot tokens named <code>AAPL</code>/<code>TSLA</code>/<code>GOOGL</code>/
          <code>NVDAX</code>/<code>XAUT0</code>/<code>XAUM</code> and a perp named <code>SPX</code> as tokenized
          equities/indices, based only on the name matching. Checking their actual live oracle price against reality
          before building anything proved that wrong: spot <code>AAPL</code> traded at <strong>$0.057</strong>, perp{" "}
          <code>SPX</code> at <strong>0.47</strong> — neither remotely close to the real thing, both on near-zero
          volume. Hyperliquid lets anyone permissionlessly deploy a spot token or perp market under any name
          (HIP-1/HIP-3); a matching ticker means nothing on its own. <code>PAXG</code> (Paxos Gold, shown above) is
          the one exception — it's a real, independently-audited, physically-redeemable gold token traded across all
          of crypto, not a Hyperliquid-native listing, and its oracle price matches real spot gold. No stock or index
          equivalent exists. The "tokenized 24/7 markets" panel originally scoped is dropped for everything except gold.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-term-muted text-[11px] tracking-widest font-bold">WHAT'S STILL A GAP</div>
        <p className="text-term-text leading-relaxed">
          Liquidations aren't in the public trade feed (no flag on individual prints) and there's no documented
          market-wide liquidation stream — only per-account, which needs a wallet you're already watching. The
          "Liquidations" filter above is left visible but disabled rather than silently removed, so the gap stays
          legible in the UI itself, not just in this writeup.
        </p>
      </div>
    </div>
  );
}
