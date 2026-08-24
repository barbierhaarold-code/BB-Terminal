import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aggregateInsiderTrading } from "@/lib/api";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle } from "@/functions/research/shared";
import { fmtVolume, fmtPrice, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { UNIVERSE } from "@/lib/universe";

/**
 * Market-wide Form 4 feed. Free via SEC (no key), same source RESEARCH's
 * Ownership tab already uses per-symbol — here it's fanned out across the
 * largest tracked tickers, since SEC's insider_trading endpoint is
 * per-symbol with no "whole market" mode. Capped at 25: OpenBB's SEC-provider
 * cache isn't safe under concurrent writers (see vite.config.ts's secGate),
 * so this fan-out is fully serialized — a wider basket just means a much
 * longer cold-cache wait for the same "top of market" coverage.
 */
const BASKET = [...UNIVERSE].sort((a, b) => b.marketCap - a.marketCap).slice(0, 25).map((c) => c.symbol);

type Filter = "all" | "buy" | "sale";

export function InsiderTradingPanel() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, error } = useQuery({
    queryKey: ["invest-insider-market"],
    queryFn: () => aggregateInsiderTrading(BASKET, 10),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data;
    return data.filter((t) => (filter === "sale" ? t.acquisition_or_disposition === "Disposition" : t.acquisition_or_disposition !== "Disposition"));
  }, [data, filter]);

  return (
    <div className="p-4 flex flex-col gap-3 text-[12px]">
      <SectionTitle>INSIDER TRADING — FORM 4 FILINGS (TOP 25 TICKERS BY MARKET CAP)</SectionTitle>
      <div className="flex gap-2">
        {(["all", "buy", "sale"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2 py-0.5 border text-[11px] uppercase",
              filter === f ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBlock err={error as Error} /> : rows.length === 0 ? (
        <EmptyBlock>No recent insider transactions.</EmptyBlock>
      ) : (
        <div className="border border-term-border overflow-auto scroll-thin max-h-[70vh]">
          <table className="w-full grid-data">
            <thead>
              <tr>
                <th>Filed</th><th>Symbol</th><th>Insider</th><th>Title</th><th>Type</th>
                <th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const disposal = t.acquisition_or_disposition === "Disposition";
                const value = (t.securities_transacted ?? 0) * (t.transaction_price ?? 0);
                return (
                  <tr key={i}>
                    <td className="num">{fmtDate(t.filing_date)}</td>
                    <td className="text-term-amberBright">{t.symbol}</td>
                    <td>{t.owner_name ?? "—"}</td>
                    <td className="text-term-muted">{t.owner_title ?? "—"}</td>
                    <td className={cn(disposal ? "down" : "up")}>{disposal ? "Sale" : "Buy"}</td>
                    <td className={cn("num text-right", disposal ? "down" : "up")}>{fmtVolume(t.securities_transacted)}</td>
                    <td className="num text-right">{fmtPrice(t.transaction_price)}</td>
                    <td className="num text-right text-term-muted">${fmtVolume(value)}</td>
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
