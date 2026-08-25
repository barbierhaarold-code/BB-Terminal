import { useQuery } from "@tanstack/react-query";
import { fetchGlobalMarketData } from "./coingeckoGlobal";
import { Loading, ErrorBlock, SectionTitle, GapNotice, ProportionBar } from "@/functions/research/shared";
import { fmtPct, fmtVolume } from "@/lib/format";
import { cn } from "@/lib/cn";

export function OnChainPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["crypto-global"],
    queryFn: fetchGlobalMarketData,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <div className="p-4 flex flex-col gap-4 text-[12px]">
      <SectionTitle>ON-CHAIN — MARKET CAP & DOMINANCE</SectionTitle>
      <div className="sub-header">COINGECKO PUBLIC API · NO KEY · 5MIN REFRESH</div>

      {isLoading ? <Loading /> : error ? <ErrorBlock err={error as Error} /> : data ? (
        <>
          <div className="flex gap-6 flex-wrap">
            <div>
              <div className="sub-header">TOTAL CRYPTO MARKET CAP</div>
              <div className="num text-[20px] text-term-heading">${fmtVolume(data.totalMarketCapUsd)}</div>
              <div className={cn("num text-[12px]", data.marketCapChangePct24h >= 0 ? "up" : "down")}>
                {fmtPct(data.marketCapChangePct24h)} 24h
              </div>
            </div>
            <div>
              <div className="sub-header">24H VOLUME</div>
              <div className="num text-[20px] text-term-heading">${fmtVolume(data.totalVolumeUsd)}</div>
            </div>
            <div>
              <div className="sub-header">TRACKED ASSETS</div>
              <div className="num text-[20px] text-term-heading">{data.activeCryptocurrencies.toLocaleString()}</div>
            </div>
          </div>

          <div className="max-w-md">
            <div className="sub-header mb-1.5">MARKET CAP DOMINANCE</div>
            <ProportionBar
              segments={[
                { label: "BTC", value: data.btcDominance, className: "bg-term-amber" },
                { label: "ETH", value: data.ethDominance, className: "bg-term-cyan" },
                { label: "Other", value: 100 - data.btcDominance - data.ethDominance, className: "bg-term-muted/40" },
              ]}
            />
          </div>
        </>
      ) : null}

      <GapNotice>
        Deeper on-chain metrics — exchange BTC/ETH reserve balances, whale wallet flows, realized cap, MVRV — aren't
        covered by any free API. CoinGecko's free tier stops at market cap and dominance, shown above. Glassnode and
        CryptoQuant both cover the deeper metrics but are paid providers; that's an open decision, not built here.
      </GapNotice>
    </div>
  );
}
