import { useQuery } from "@tanstack/react-query";
import { fetchConsensus } from "@/lib/api";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DataNote } from "./research/shared";

export function EE({ symbol }: { symbol: string }) {
  const { data: e, isLoading, error } = useQuery({
    queryKey: ["consensus", symbol], queryFn: () => fetchConsensus(symbol),
  });

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (!e) return <div className="p-4 text-term-muted">No estimates.</div>;

  const upside = e.target_consensus != null && e.current_price != null
    ? ((e.target_consensus - e.current_price) / e.current_price) * 100
    : undefined;

  const rec = (e.recommendation ?? "").toUpperCase();
  const recColor = /STRONG.BUY|BUY/.test(rec) ? "up" : /SELL|UNDER/.test(rec) ? "down" : "amber";

  return (
    <div className="p-4 grid gap-6 md:grid-cols-2 text-[12px]">
      <div className="md:col-span-2"><DataNote>The consensus is the average view of the analysts covering the stock: a recommendation (buy / hold / sell), a price target range and how many analysts contribute. Useful to gauge market sentiment and expectations. Analysts are often wrong and slow to revise; a target is not a prediction.</DataNote></div>
      <div>
        <div className="sub-header">CONSENSUS RECOMMENDATION</div>
        <div className={cn("text-3xl font-bold tracking-widest mt-2",
          recColor === "up" && "up", recColor === "down" && "down", recColor === "amber" && "amber")}>
          {rec || "—"}
        </div>
        <div className="sub-header mt-1">RATING SCORE {e.recommendation_mean?.toFixed(2) ?? "—"} / 5</div>
        <div className="sub-header mt-0.5">ANALYSTS COVERING <span className="text-term-text num ml-1">{e.number_of_analysts ?? "—"}</span></div>
      </div>
      <div className="border-l border-term-border pl-6">
        <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-6">
          <div className="sub-header">CURRENT PRICE</div>
          <div className="num text-right text-term-heading">{fmtPrice(e.current_price)}</div>

          <div className="sub-header text-term-amber">TARGET CONSENSUS</div>
          <div className="num text-right text-term-amber text-[14px] font-semibold">{fmtPrice(e.target_consensus)}</div>

          <div className="sub-header">TARGET MEDIAN</div>
          <div className="num text-right">{fmtPrice(e.target_median)}</div>

          <div className="sub-header up">TARGET HIGH</div>
          <div className="num text-right up">{fmtPrice(e.target_high)}</div>

          <div className="sub-header down">TARGET LOW</div>
          <div className="num text-right down">{fmtPrice(e.target_low)}</div>

          <div className="sub-header">IMPLIED UPSIDE</div>
          <div className={cn("num text-right", upside != null && (upside >= 0 ? "up" : "down"))}>
            {fmtPct(upside)}
          </div>
        </div>
      </div>
    </div>
  );
}
