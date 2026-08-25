import { useQuery } from "@tanstack/react-query";
import { fetchDerivatives } from "./binanceFutures";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle } from "@/functions/research/shared";
import { fmtPrice, fmtVolume, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

export function DerivativesPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["crypto-derivatives"],
    queryFn: fetchDerivatives,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const rows = data ?? [];

  return (
    <div className="p-4 flex flex-col gap-3 text-[12px]">
      <SectionTitle>DERIVATIVES — MAJOR USDT PERPETUALS</SectionTitle>
      <div className="sub-header">BINANCE FUTURES PUBLIC API · NO KEY · 30S REFRESH</div>

      {isLoading ? <Loading /> : error ? <ErrorBlock err={error as Error} /> : rows.length === 0 ? (
        <EmptyBlock>No derivatives data returned.</EmptyBlock>
      ) : (
        <div className="border border-term-border overflow-auto scroll-thin max-h-[70vh]">
          <table className="w-full grid-data">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="text-right">Mark Price</th>
                <th className="text-right">Funding Rate</th>
                <th className="text-right">Next Funding</th>
                <th className="text-right">Open Interest</th>
                <th className="text-right">OI Notional</th>
                <th className="text-right">Long / Short Accts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fundingPct = r.fundingRate * 100;
                const nextFunding = new Date(r.nextFundingTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                return (
                  <tr key={r.symbol}>
                    <td className="text-term-amber font-semibold">{r.symbol.replace("USDT", "")}</td>
                    <td className="num text-right">{fmtPrice(r.markPrice, r.markPrice < 1 ? 4 : 2)}</td>
                    <td className={cn("num text-right", fundingPct >= 0 ? "up" : "down")}>{fmtPct(fundingPct, 4)}</td>
                    <td className="num text-right text-term-muted">{nextFunding}</td>
                    <td className="num text-right">{fmtVolume(r.openInterest)}</td>
                    <td className="num text-right">${fmtVolume(r.openInterestNotional)}</td>
                    <td className="text-right">
                      {Number.isNaN(r.longAccountPct) ? (
                        <span className="text-term-muted">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className="up">{r.longAccountPct.toFixed(1)}%</span>
                          <span className="text-term-muted">/</span>
                          <span className="down">{r.shortAccountPct.toFixed(1)}%</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
