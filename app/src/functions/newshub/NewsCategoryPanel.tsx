import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NewsItem } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  label: string;
  sourceNote: string;
  queryKey: string;
  fetcher: () => Promise<NewsItem[]>;
}

/** One quadrant of the News tab's General/Stocks/Crypto/Forex grid — same
 * headline-row markup as NI.tsx, plus a client-side search filter (no new
 * backend call needed) and a manual refresh button. */
export function NewsCategoryPanel({ label, sourceNote, queryKey, fetcher }: Props) {
  const [q, setQ] = useState("");
  const { data = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["newshub-news", queryKey],
    queryFn: () => fetcher(),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const needle = q.trim().toLowerCase();
    return data.filter(
      (n) => n.title.toLowerCase().includes(needle) || (n.source ?? "").toLowerCase().includes(needle)
    );
  }, [data, q]);

  return (
    <div className="panel min-h-0">
      <div className="panel-header">
        <span>{label}</span>
        <span className="normal-case tracking-normal font-normal text-term-muted">{sourceNote}</span>
      </div>
      <div className="flex items-center gap-2 h-8 px-2 border-b border-term-border bg-term-panel2">
        <Search size={11} className="text-term-muted shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter headlines…"
          className="flex-1 min-w-0 bg-transparent text-[11px] placeholder:text-term-muted focus:outline-none"
        />
        <button
          onClick={() => refetch()}
          title="Refresh"
          className="text-term-muted hover:text-term-amber shrink-0"
        >
          <RefreshCw size={12} className={cn(isFetching && "animate-spin")} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin divide-y divide-term-borderSoft text-[12px]">
        {isLoading && <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
        {error && <div className="p-4 text-term-red">{(error as Error).message}</div>}
        {!isLoading && !error && filtered.map((n, i) => (
          <a
            key={n.id + i}
            href={n.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-start gap-2 px-3 py-2 hover:bg-term-amberSubtle group"
          >
            <div className="num text-term-muted w-20 shrink-0 text-[10px] pt-0.5">{fmtTime(n.date)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-term-heading group-hover:text-term-amber leading-snug">{n.title}</div>
              <div className="text-term-muted text-[10px] uppercase tracking-widest mt-0.5">{n.source}</div>
            </div>
            <ExternalLink size={11} className="text-term-muted group-hover:text-term-amber mt-1 shrink-0" />
          </a>
        ))}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="p-4 text-term-muted">{q ? "No matching headlines." : "No news."}</div>
        )}
      </div>
    </div>
  );
}
