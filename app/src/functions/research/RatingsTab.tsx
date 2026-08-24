import { useQuery } from "@tanstack/react-query";
import { fetchConsensus, fetchRatingChanges } from "@/lib/api";
import { fmtPrice, fmtPct, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle } from "./shared";

/** Extends EE: same consensus query key (no refetch) plus a free finviz
 * upgrade/downgrade feed — fmp's equivalent price_target endpoint is
 * restricted on this app's free tier (verified live). */
export function RatingsTab({ symbol }: { symbol: string }) {
  const consensusQ = useQuery({ queryKey: ["consensus", symbol], queryFn: () => fetchConsensus(symbol) });
  const changesQ = useQuery({ queryKey: ["rating-changes", symbol], queryFn: () => fetchRatingChanges(symbol, 30) });

  const e = consensusQ.data;
  const changes = changesQ.data ?? [];

  if (consensusQ.isLoading) return <Loading />;
  if (consensusQ.error) return <ErrorBlock err={consensusQ.error as Error} />;

  const upside = e?.target_consensus != null && e?.current_price != null
    ? ((e.target_consensus - e.current_price) / e.current_price) * 100
    : undefined;
  const rec = (e?.recommendation ?? "").toUpperCase();
  const recColor = /STRONG.BUY|BUY/.test(rec) ? "up" : /SELL|UNDER/.test(rec) ? "down" : "amber";

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px]">
      <div>
        <SectionTitle>CONSENSUS</SectionTitle>
        <div className="grid gap-6 md:grid-cols-2 max-w-3xl">
          <div>
            <div className={cn("text-3xl font-bold tracking-widest", recColor === "up" && "up", recColor === "down" && "down", recColor === "amber" && "amber")}>
              {rec || "—"}
            </div>
            <div className="sub-header mt-1">SCORE {e?.recommendation_mean?.toFixed(2) ?? "—"} / 5 · {e?.number_of_analysts ?? "—"} ANALYSTS</div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-6">
            <div className="sub-header">CURRENT PRICE</div><div className="num text-right text-term-heading">{fmtPrice(e?.current_price)}</div>
            <div className="sub-header text-term-amber">TARGET CONSENSUS</div><div className="num text-right text-term-amber font-semibold">{fmtPrice(e?.target_consensus)}</div>
            <div className="sub-header up">TARGET HIGH</div><div className="num text-right up">{fmtPrice(e?.target_high)}</div>
            <div className="sub-header down">TARGET LOW</div><div className="num text-right down">{fmtPrice(e?.target_low)}</div>
            <div className="sub-header">IMPLIED UPSIDE</div>
            <div className={cn("num text-right", upside != null && (upside >= 0 ? "up" : "down"))}>{fmtPct(upside)}</div>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>RATING CHANGES (UPGRADES / DOWNGRADES)</SectionTitle>
        {changesQ.isLoading ? <Loading /> : changesQ.error ? <ErrorBlock err={changesQ.error as Error} /> : changes.length === 0 ? (
          <EmptyBlock>No recent rating changes for {symbol}.</EmptyBlock>
        ) : (
          <div className="border border-term-border max-h-[420px] overflow-auto scroll-thin">
            <table className="w-full grid-data">
              <thead>
                <tr><th>Date</th><th>Firm</th><th>Action</th><th>Rating Change</th><th className="text-right">Price Target</th></tr>
              </thead>
              <tbody>
                {changes.map((c, i) => {
                  const target = c.adj_price_target ?? c.price_target;
                  const color = /upgrade/i.test(c.status ?? "") ? "up" : /downgrade/i.test(c.status ?? "") ? "down" : "amber";
                  return (
                    <tr key={i}>
                      <td className="num">{fmtDate(c.published_date)}</td>
                      <td>{c.analyst_company ?? "—"}</td>
                      <td className={cn(color)}>{c.status ?? "—"}</td>
                      <td className="text-term-muted">{c.rating_change ?? "—"}</td>
                      <td className="num text-right">{target != null ? fmtPrice(target) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
