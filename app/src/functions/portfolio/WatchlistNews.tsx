import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { aggregateCompanyNews } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { usePortfolio } from "@/store/portfolioStore";

export function WatchlistNews() {
  const positions = usePortfolio((s) => s.positions);
  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol))), [positions]);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["portfolio-watchlist-news", symbols.join(",")],
    queryFn: () => aggregateCompanyNews(symbols, { perSymbol: 15, limit: 60 }),
    enabled: symbols.length > 0,
    staleTime: 60_000,
  });

  if (positions.length === 0) {
    return <div className="p-6 text-center text-term-muted text-[12px] uppercase tracking-widest">No positions yet — news will show up here once you hold something.</div>;
  }
  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;

  return (
    <div className="divide-y divide-term-borderSoft text-[12px]">
      {data.map((n, i) => (
        <a key={n.id + i} href={n.url} target="_blank" rel="noreferrer noopener"
          className="flex items-start gap-3 px-4 py-2 hover:bg-term-amberSubtle group">
          <div className="num text-term-amber font-semibold w-14 shrink-0">{n.symbol ?? ""}</div>
          <div className="num text-term-muted w-28 shrink-0">{fmtTime(n.date)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-term-heading group-hover:text-term-amber leading-snug">{n.title}</div>
            {n.summary && <div className="text-term-muted mt-0.5 line-clamp-2">{n.summary}</div>}
            <div className="text-term-muted text-[10px] uppercase tracking-widest mt-0.5">{n.source}</div>
          </div>
          <ExternalLink size={12} className="text-term-muted group-hover:text-term-amber mt-1 shrink-0" />
        </a>
      ))}
      {data.length === 0 && <div className="p-4 text-term-muted">No news for held tickers.</div>}
    </div>
  );
}
