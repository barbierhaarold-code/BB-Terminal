import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchQuotes, fetchProfile, type Quote, type Profile } from "@/lib/api";
import { fmtPrice, fmtPct, dirClass } from "@/lib/format";
import { usePortfolio } from "@/store/portfolioStore";
import { computePositionMetrics, sectorAllocation } from "@/lib/portfolio";
import { cn } from "@/lib/cn";

const BAR_COLORS = ["#b45cff", "#22ccee", "#22ee22", "#ff3b3b", "#cd93ff", "#6d2ea6", "#8a8a8a"];

export function AllocationPanel() {
  const positions = usePortfolio((s) => s.positions);
  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions]);

  const quotesQ = useQuery({
    queryKey: ["portfolio-alloc-quotes", symbols.join(",")],
    queryFn: () => fetchQuotes(symbols),
    enabled: symbols.length > 0,
    staleTime: 15_000,
  });
  const quoteBySymbol = useMemo(() => {
    const m = new Map<string, Quote>();
    for (const q of quotesQ.data ?? []) m.set(q.symbol, q);
    return m;
  }, [quotesQ.data]);

  const profileQs = useQueries({
    queries: symbols.map((s) => ({
      queryKey: ["portfolio-profile", s],
      queryFn: () => fetchProfile(s),
      staleTime: 10 * 60_000,
    })),
  });
  const sectorBySymbol = useMemo(() => {
    const m = new Map<string, string | undefined>();
    symbols.forEach((s, i) => m.set(s, (profileQs[i].data as Profile | undefined)?.sector));
    return m;
  }, [symbols, profileQs]);

  const rows = useMemo(() => computePositionMetrics(positions, quoteBySymbol), [positions, quoteBySymbol]);
  const sectors = useMemo(() => sectorAllocation(rows, sectorBySymbol), [rows, sectorBySymbol]);
  const byName = useMemo(
    () => [...rows]
      .filter((r) => r.marketValue != null && r.marketValue > 0)
      .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    [rows]
  );

  if (positions.length === 0) {
    return <div className="p-6 text-center text-term-muted text-[12px] uppercase tracking-widest">No positions yet.</div>;
  }

  return (
    <div className="p-4 flex flex-col gap-6 max-w-3xl">
      <section>
        <div className="sub-header mb-3">Sector allocation</div>
        <div className="flex flex-col gap-2">
          {sectors.map((s, i) => (
            <div key={s.sector} className="flex items-center gap-3 text-[12px]">
              <span className="w-40 shrink-0 truncate text-term-text">{s.sector}</span>
              <div className="flex-1 h-4 bg-term-panel2 border border-term-borderSoft relative overflow-hidden">
                <div className="h-full" style={{ width: `${s.weight}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
              </div>
              <span className="num w-16 text-right text-term-muted shrink-0">{s.weight.toFixed(1)}%</span>
              <span className="num w-20 text-right text-term-heading shrink-0">{fmtPrice(s.value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="sub-header mb-3">Per-name weight</div>
        <div className="flex flex-col gap-2">
          {byName.map((r) => (
            <div key={r.position.id} className="flex items-center gap-3 text-[12px]">
              <span className="w-16 shrink-0 num text-term-amber font-semibold">{r.position.symbol}</span>
              <div className="flex-1 h-4 bg-term-panel2 border border-term-borderSoft relative overflow-hidden">
                <div className="h-full bg-term-amber" style={{ width: `${r.weight ?? 0}%`, opacity: 0.7 }} />
              </div>
              <span className="num w-16 text-right text-term-muted shrink-0">{(r.weight ?? 0).toFixed(1)}%</span>
              <span className={cn("num w-20 text-right shrink-0", dirClass(r.totalPnlPct))}>{fmtPct(r.totalPnlPct)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
