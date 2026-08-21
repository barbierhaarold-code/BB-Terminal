import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap, type HierarchyRectangularNode } from "d3-hierarchy";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchQuotes, fetchHistorical, type Candle } from "@/lib/api";
import { fmtPct } from "@/lib/format";
import { membersOf, INDEX_LABELS, type IndexId } from "@/lib/universe";
import { useSectorPerformance } from "@/lib/sectors";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";

const RANGES = [
  { label: "Today", days: 0 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "YTD", days: -1 },
  { label: "1Y", days: 365 },
];
const INDEX_TABS: IndexId[] = ["sp500", "nasdaq100", "dow30"];
const TILE_CAP = 120; // bound the per-ticker fan-out for non-"Today" ranges

interface Leaf { name: string; symbol: string; sector: string; industry: string; value: number; pct?: number; }
interface TreeNode { name: string; sector?: string; children?: TreeNode[]; leaf?: Leaf; }

/** Diverging green↔red fill from a % change, clamped to ±4%. */
function heatColor(pct: number | undefined): string {
  if (pct == null) return "rgba(40,40,40,0.9)";
  const c = Math.max(-4, Math.min(4, pct)) / 4; // -1..1
  const a = 0.18 + Math.abs(c) * 0.62;
  return c >= 0 ? `rgba(34,238,34,${a.toFixed(3)})` : `rgba(255,59,59,${a.toFixed(3)})`;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export function HEAT() {
  const openTab = useWorkspace((s) => s.openTab);
  const [index, setIndex] = useState<IndexId>("sp500");
  const [range, setRange] = useState(RANGES[0]);
  const members = useMemo(() => membersOf(index), [index]);
  const allSymbols = useMemo(() => members.map((m) => m.symbol), [members]);

  // Batched quotes drive tile size (market cap) and "Today" coloring.
  const quotesQ = useQuery({
    queryKey: ["heat-quotes", index],
    queryFn: () => fetchQuotes(allSymbols),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  // Quotes supply only the live "Today" change; market cap is the static snapshot.
  const chgBy = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const q of quotesQ.data ?? []) {
      const chgPct = q.change_percent != null ? q.change_percent
        : q.last_price != null && q.prev_close ? ((q.last_price - q.prev_close) / q.prev_close) * 100 : undefined;
      m.set(q.symbol, chgPct);
    }
    return m;
  }, [quotesQ.data]);

  // Bound the universe to the largest TILE_CAP by (static) market cap.
  const capped = useMemo(() => {
    return [...members]
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, TILE_CAP)
      .map((c) => ({ c }));
  }, [members]);

  // For non-"Today" ranges, fetch per-ticker window returns (only the capped set).
  const wantHist = range.label !== "Today";
  const startDate = range.days === -1
    ? `${new Date().getFullYear()}-01-01`
    : new Date(Date.now() - Math.max(1, range.days) * 864e5).toISOString().slice(0, 10);
  const histQs = useQueries({
    queries: capped.map(({ c }) => ({
      queryKey: ["heat-hist", c.symbol, range.label],
      queryFn: () => fetchHistorical(c.symbol, { start_date: startDate }),
      enabled: wantHist,
      staleTime: 5 * 60_000,
    })),
  });
  const histPct = useMemo(() => {
    const m = new Map<string, number>();
    if (!wantHist) return m;
    capped.forEach(({ c }, i) => {
      const data = histQs[i].data as Candle[] | undefined;
      if (data && data.length >= 2) {
        m.set(c.symbol, (data[data.length - 1].close / data[0].close - 1) * 100);
      }
    });
    return m;
  }, [capped, histQs, wantHist]);

  // Build sector → industry → ticker hierarchy.
  const root: TreeNode = useMemo(() => {
    const bySector = new Map<string, Map<string, Leaf[]>>();
    for (const { c } of capped) {
      const cap = c.marketCap;
      if (cap <= 0) continue;
      const pct = wantHist ? histPct.get(c.symbol) : chgBy.get(c.symbol);
      const leaf: Leaf = { name: c.symbol, symbol: c.symbol, sector: c.sector, industry: c.industry, value: cap, pct };
      if (!bySector.has(c.sector)) bySector.set(c.sector, new Map());
      const ind = bySector.get(c.sector)!;
      if (!ind.has(c.industry)) ind.set(c.industry, []);
      ind.get(c.industry)!.push(leaf);
    }
    return {
      name: "root",
      children: Array.from(bySector.entries()).map(([sector, inds]) => ({
        name: sector, sector,
        children: Array.from(inds.entries()).map(([industry, leaves]) => ({
          name: industry, sector,
          children: leaves.map((l) => ({ name: l.symbol, sector, leaf: l })),
        })),
      })),
    };
  }, [capped, chgBy, histPct, wantHist]);

  const { ref, size } = useSize<HTMLDivElement>();

  const layout = useMemo(() => {
    const h = hierarchy<TreeNode>(root)
      .sum((d) => d.leaf?.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<TreeNode>().size([size.w, size.h]).paddingTop(14).paddingInner(1).round(true)(h);
    return h as HierarchyRectangularNode<TreeNode>;
  }, [root, size]);

  const sectorPerf = useSectorPerformance();
  const sectorPctByName = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const s of sectorPerf) m.set(s.def.name, s.changePct);
    return m;
  }, [sectorPerf]);

  const leaves = layout.leaves();
  const sectorCells = layout.descendants().filter((d) => d.depth === 1);
  const loading = quotesQ.isLoading || (wantHist && histQs.some((q) => q.isLoading));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap px-3 h-auto py-2 border-b border-term-border bg-term-panel2 text-[11px]">
        <div className="flex items-center gap-1">
          {INDEX_TABS.map((t) => (
            <button key={t} onClick={() => setIndex(t)}
              className={cn("px-2 py-0.5 border uppercase tracking-wider",
                t === index ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {INDEX_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-term-border" />
        {RANGES.map((r) => (
          <button key={r.label} onClick={() => setRange(r)}
            className={cn("px-1.5 py-0.5 border uppercase tracking-wider",
              r.label === range.label ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {r.label}
          </button>
        ))}
        <span className="ml-auto sub-header">size = mkt cap · color = {range.label.toLowerCase()} %{members.length > TILE_CAP ? ` · top ${TILE_CAP}` : ""}</span>
      </div>

      <div ref={ref} className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-term-muted text-[11px] uppercase tracking-widest z-10 pointer-events-none">
            LOADING…
          </div>
        )}
        <svg width={size.w} height={size.h} className="block">
          {/* Sector group frames + labels (colored by the shared sector source) */}
          {sectorCells.map((s) => {
            const spct = sectorPctByName.get(s.data.name);
            return (
              <g key={`sec-${s.data.name}`}>
                <rect x={s.x0} y={s.y0} width={Math.max(0, s.x1 - s.x0)} height={Math.max(0, s.y1 - s.y0)}
                  fill="none" stroke="#2a2a2a" strokeWidth={1} />
                <text x={s.x0 + 4} y={s.y0 + 10} className="fill-term-muted" style={{ fontSize: 9, letterSpacing: "0.08em" }}>
                  {s.data.name.toUpperCase()} {spct != null ? `${spct >= 0 ? "+" : ""}${spct.toFixed(2)}%` : ""}
                </text>
              </g>
            );
          })}
          {/* Ticker tiles */}
          {leaves.map((l) => {
            const w = Math.max(0, l.x1 - l.x0), h = Math.max(0, l.y1 - l.y0);
            const leaf = l.data.leaf!;
            const showText = w > 34 && h > 18;
            return (
              <g key={leaf.symbol} className="cursor-pointer" onClick={() => openTab("INTEL", leaf.symbol)}>
                <title>{`${leaf.symbol} · ${leaf.industry}\n${fmtPct(leaf.pct)}`}</title>
                <rect x={l.x0} y={l.y0} width={w} height={h} fill={heatColor(leaf.pct)} stroke="#0a0a0a" strokeWidth={0.5} />
                {showText && (
                  <>
                    <text x={l.x0 + w / 2} y={l.y0 + h / 2 - 1} textAnchor="middle" className="fill-term-heading"
                      style={{ fontSize: Math.min(13, Math.max(8, w / 4)), fontWeight: 700 }}>
                      {leaf.symbol}
                    </text>
                    {h > 30 && (
                      <text x={l.x0 + w / 2} y={l.y0 + h / 2 + 11} textAnchor="middle" className="fill-term-heading"
                        style={{ fontSize: 9, opacity: 0.85 }}>
                        {leaf.pct != null ? `${leaf.pct >= 0 ? "+" : ""}${leaf.pct.toFixed(2)}%` : "—"}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
