import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { fetchPredictionMarkets } from "@/lib/api";
import { fmtVolume, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const CATEGORY_LABEL: Record<string, string> = {
  fed: "Fed", "interest-rates": "Rates", economy: "Economy", recession: "Recession",
  geopolitics: "Geopolitics", "international-affairs": "Intl. Affairs", elections: "Elections",
};

export function PredictionMarketsPanel() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["newshub-prediction-markets"],
    queryFn: fetchPredictionMarkets,
    staleTime: 3 * 60_000,
    refetchInterval: 3 * 60_000,
  });

  const stats = useMemo(() => {
    const totalVolume = data.reduce((s, m) => s + m.volume, 0);
    const categories = new Set(data.map((m) => m.category));
    const in30d = data.filter((m) => {
      if (!m.resolveDate) return false;
      const days = (new Date(m.resolveDate).getTime() - Date.now()) / 864e5;
      return days >= 0 && days <= 30;
    }).length;
    return { tracked: data.length, totalVolume, categories: categories.size, in30d };
  }, [data]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="grid grid-cols-4 gap-2 p-2 text-[11px] shrink-0">
        {[
          { label: "MARKETS TRACKED", val: stats.tracked.toString() },
          { label: "TOTAL VOLUME", val: fmtVolume(stats.totalVolume) },
          { label: "CATEGORIES", val: stats.categories.toString() },
          { label: "RESOLVING ≤30D", val: stats.in30d.toString() },
        ].map((s) => (
          <div key={s.label} className="border border-term-border p-2.5 flex flex-col gap-1">
            <span className="sub-header">{s.label}</span>
            <span className="num text-term-heading text-[16px] font-bold">{s.val}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin px-2 pb-2">
        {isLoading && <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
        {error && <div className="p-4 text-term-red">{(error as Error).message}</div>}
        {!isLoading && !error && data.length === 0 && <div className="p-4 text-term-muted">No markets returned.</div>}
        {!isLoading && !error && data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {data.map((m) => {
              const changePts = m.probabilityWeekAgo != null ? (m.probability - m.probabilityWeekAgo) * 100 : undefined;
              return (
                <a
                  key={m.id}
                  href={m.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="border border-term-border p-2.5 flex flex-col gap-1.5 hover:border-term-amber/60 hover:bg-term-amberSubtle group text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="sub-header">{CATEGORY_LABEL[m.category] ?? m.category}</span>
                    <ExternalLink size={11} className="text-term-muted group-hover:text-term-amber shrink-0" />
                  </div>
                  <div className="text-term-heading leading-snug flex-1">{m.question}</div>
                  <div className="flex items-end justify-between mt-1">
                    <div className="flex flex-col">
                      <span className="num text-term-amberBright text-[18px] font-bold leading-none">{(m.probability * 100).toFixed(0)}%</span>
                      {changePts != null && (
                        <span className={cn("num text-[10px]", changePts >= 0 ? "up" : "down")}>
                          {changePts >= 0 ? "+" : ""}{changePts.toFixed(1)}pt / 7d
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="num text-term-muted text-[10px]">VOL {fmtVolume(m.volume)}</div>
                      {m.resolveDate && <div className="num text-term-muted text-[10px]">RES {fmtDate(m.resolveDate)}</div>}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <div className="sub-header px-2 py-1 border-t border-term-borderSoft shrink-0">
        POWERED BY POLYMARKET'S PUBLIC GAMMA API (FREE, NO KEY) · CURATED TO FED/RATES/ECONOMY/GEOPOLITICS TAGS ·
        KALSHI IS A GOOD SECOND SOURCE FOR A LATER PASS, NOT WIRED HERE.
      </div>
    </div>
  );
}
