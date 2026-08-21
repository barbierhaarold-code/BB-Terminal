import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchQuotes, fetchHistorical, type Candle } from "@/lib/api";
import { fmtPrice, fmtPct, fmtVolume } from "@/lib/format";
import {
  UNIVERSE, membersOf, UNIVERSE_SECTORS, industriesForSector,
  INDEX_LABELS, type IndexId, type Constituent,
} from "@/lib/universe";
import { useFavorites } from "@/store/favoritesStore";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";

type MembershipFilter = IndexId | "favorites";
type SortKey = "mktcap" | "change" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "mktcap", label: "Mkt Cap" },
  { key: "change", label: "Change" },
  { key: "name", label: "Name" },
];
const TIMEFRAMES = [
  { label: "1D", days: 1, interval: "5m" },
  { label: "1W", days: 7, interval: "1d" },
  { label: "1M", days: 30, interval: "1d" },
  { label: "3M", days: 90, interval: "1d" },
  { label: "1Y", days: 365, interval: "1d" },
];
const VISIBLE_CAP = 60;

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="h-8" />;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 30 - ((v - min) / (max - min || 1)) * 26;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="w-full h-8">
      <polyline fill="none" stroke={up ? "#22ee22" : "#ff3b3b"} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

export function QCARD() {
  const openTab = useWorkspace((s) => s.openTab);
  const { favorites, toggleFavorite } = useFavorites();

  const [membership, setMembership] = useState<MembershipFilter>("sp500");
  const [sector, setSector] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("mktcap");
  const [tf, setTf] = useState(TIMEFRAMES[2]);

  const industryOptions = useMemo(() => industriesForSector(sector || undefined), [sector]);

  // Base list from the chosen membership.
  const base: Constituent[] = useMemo(() => {
    if (membership === "favorites") {
      const set = new Set(favorites);
      return UNIVERSE.filter((c) => set.has(c.symbol));
    }
    return membersOf(membership);
  }, [membership, favorites]);

  // Text/sector/industry filters.
  const filtered = useMemo(() => {
    const s = search.trim().toUpperCase();
    return base.filter((c) =>
      (!sector || c.sector === sector) &&
      (!industry || c.industry === industry) &&
      (!s || c.symbol.includes(s) || c.name.toUpperCase().includes(s))
    );
  }, [base, sector, industry, search]);

  const symbols = useMemo(() => filtered.map((c) => c.symbol), [filtered]);

  // Batched quotes for the whole filtered set (needed to sort by cap/change).
  const quotesQ = useQuery({
    queryKey: ["qcard-quotes", symbols.join(",")],
    queryFn: () => fetchQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const quoteBy = useMemo(() => {
    const m = new Map<string, { last?: number; chgPct?: number; vol?: number }>();
    for (const q of quotesQ.data ?? []) {
      const chgPct = q.change_percent != null ? q.change_percent
        : q.last_price != null && q.prev_close ? ((q.last_price - q.prev_close) / q.prev_close) * 100 : undefined;
      m.set(q.symbol, { last: q.last_price, chgPct, vol: q.volume });
    }
    return m;
  }, [quotesQ.data]);

  // Sort, then cap the rendered set. Market cap is the static snapshot; change is live.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sort === "name") return a.symbol < b.symbol ? -1 : 1;
      if (sort === "change") {
        const ca = quoteBy.get(a.symbol)?.chgPct ?? -Infinity;
        const cb = quoteBy.get(b.symbol)?.chgPct ?? -Infinity;
        return cb - ca;
      }
      return b.marketCap - a.marketCap;
    });
    return arr;
  }, [filtered, sort, quoteBy]);

  const visible = sorted.slice(0, VISIBLE_CAP);

  // Sparklines only for the visible cards.
  const sparkQs = useQueries({
    queries: visible.map((c) => ({
      queryKey: ["qcard-spark", c.symbol, tf.label],
      queryFn: () => fetchHistorical(c.symbol, {
        interval: tf.interval,
        start_date: new Date(Date.now() - tf.days * 864e5).toISOString().slice(0, 10),
      }),
      staleTime: 5 * 60_000,
    })),
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap px-3 h-auto py-2 border-b border-term-border bg-term-panel2 text-[11px]">
        <div className="flex items-center gap-1">
          {(["sp500", "nasdaq100", "dow30", "favorites"] as MembershipFilter[]).map((m) => (
            <button key={m} onClick={() => { setMembership(m); }}
              className={cn("px-2 py-0.5 border uppercase tracking-wider",
                m === membership ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {m === "favorites" ? `★ Favorites` : INDEX_LABELS[m as IndexId]}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-term-border" />
        <select value={sector} onChange={(e) => { setSector(e.target.value); setIndustry(""); }}
          className="bg-term-panel border border-term-border px-1 py-0.5 text-term-text focus:outline-none focus:border-term-amber">
          <option value="">All sectors</option>
          {UNIVERSE_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)}
          className="bg-term-panel border border-term-border px-1 py-0.5 text-term-text focus:outline-none focus:border-term-amber max-w-[180px]">
          <option value="">All industries</option>
          {industryOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SEARCH…" spellCheck={false}
          className="bg-term-panel border border-term-border px-2 py-0.5 text-term-amberBright placeholder:text-term-muted focus:outline-none focus:border-term-amber uppercase w-28" />
        <div className="w-px h-4 bg-term-border" />
        <span className="sub-header">SORT</span>
        {SORTS.map((s) => (
          <button key={s.key} onClick={() => setSort(s.key)}
            className={cn("px-1.5 py-0.5 border uppercase tracking-wider",
              s.key === sort ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {s.label}
          </button>
        ))}
        <div className="w-px h-4 bg-term-border" />
        {TIMEFRAMES.map((t) => (
          <button key={t.label} onClick={() => setTf(t)}
            className={cn("px-1.5 py-0.5 border uppercase tracking-wider",
              t.label === tf.label ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {t.label}
          </button>
        ))}
        <span className="ml-auto sub-header">
          {filtered.length} match{filtered.length === 1 ? "" : "es"}{sorted.length > VISIBLE_CAP ? ` · top ${VISIBLE_CAP}` : ""}
        </span>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-auto scroll-thin p-3">
        {symbols.length === 0 && (
          <div className="text-term-muted p-6 text-center text-[12px] uppercase tracking-widest">
            {membership === "favorites" ? "No favorites yet — click ★ on a card." : "No matches."}
          </div>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
          {visible.map((c, i) => {
            const q = quoteBy.get(c.symbol);
            const dir = q?.chgPct == null ? "flat" : q.chgPct >= 0 ? "up" : "down";
            const closes = (sparkQs[i].data as Candle[] | undefined)?.map((d) => d.close) ?? [];
            const fav = favorites.includes(c.symbol);
            return (
              <div key={c.symbol}
                onClick={() => openTab("INTEL", c.symbol)}
                className="panel cursor-pointer hover:border-term-amber transition-colors">
                <div className="flex items-center gap-2 p-2 border-b border-term-borderSoft">
                  <div className="w-7 h-7 shrink-0 grid place-items-center bg-term-panel2 border border-term-border text-term-amber text-[10px] font-bold">
                    {c.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-term-amber font-bold text-[12px] num">{c.symbol}</div>
                    <div className="text-term-muted text-[10px] truncate">{c.name}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(c.symbol); }}
                    className={cn("text-[14px] leading-none", fav ? "text-term-amber" : "text-term-muted hover:text-term-amber")}
                    title={fav ? "Remove favorite" : "Add favorite"}>
                    {fav ? "★" : "☆"}
                  </button>
                </div>
                <div className="p-2 flex items-end justify-between gap-2">
                  <div>
                    <div className="num text-[15px] text-term-heading">
                      {quotesQ.isLoading ? "…" : q?.last != null ? fmtPrice(q.last) : "—"}
                    </div>
                    <div className={cn("num text-[11px]", dir === "up" && "up", dir === "down" && "down")}>
                      {fmtPct(q?.chgPct)}
                    </div>
                  </div>
                  <div className="w-20">
                    <Spark values={closes} up={dir !== "down"} />
                  </div>
                </div>
                <div className="px-2 pb-1.5 flex items-center justify-between text-[9px] sub-header">
                  <span className="truncate">{c.sector}</span>
                  <span className="num">{c.marketCap ? fmtVolume(c.marketCap) : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
