import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchForexNews, type Candle } from "@/lib/api";
import {
  FX_BOARD, MAJORS, CROSSES, METALS, DXY, type Instrument,
  intradayStats, intradayQueryOptions, sparkCloses, dataAgeMs, isStale, fmtAge, useStaleBust,
} from "@/lib/forex";
import { fmtPrice, fmtPct, fmtTime } from "@/lib/format";
import { SessionsClock } from "@/components/SessionsClock";
import { XauScalper } from "@/components/XauScalper";
import { GoldIntelligence } from "@/components/GoldIntelligence";
import { cn } from "@/lib/cn";
import { ExternalLink } from "lucide-react";

interface Cell {
  candles?: Candle[];
  isLoading: boolean;
  error?: Error | null;
  updatedAt: number;
}

// GC=F stays in FX_BOARD for search/GP routing (see forex.ts), but nothing
// here reads its yfinance candles anymore — the scalper sources gold from
// the Twelve Data spot feed directly. Skip the otherwise-unused fetch.
const BOARD_FETCH_LIST = FX_BOARD.filter((inst) => inst.symbol !== "GC=F");

export function FXC() {
  // One intraday series per instrument — the single price source for the board.
  // Shared query keys mean the tape/scalper reuse these exact fetches.
  const results = useQueries({ queries: BOARD_FETCH_LIST.map((inst) => intradayQueryOptions(inst)) });

  const cellBySym = new Map<string, Cell>();
  BOARD_FETCH_LIST.forEach((inst, i) => {
    const r = results[i];
    cellBySym.set(inst.symbol, {
      candles: r.data as Candle[] | undefined,
      isLoading: r.isLoading,
      error: r.error as Error | null,
      updatedAt: r.dataUpdatedAt,
    });
  });

  const news = useQuery({
    queryKey: ["fx-news"],
    queryFn: () => fetchForexNews(40),
    staleTime: 120_000,
  });

  return (
    <div className="p-3 flex flex-col gap-3 text-[12px]">
      {/* Top band: scalper widget · silver · sessions clock */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.6fr)" }}>
        <XauScalper />
        <FxCard inst={METALS[1]} cell={cellBySym.get(METALS[1].symbol)} size="lg" />
        <SessionsClock />
      </div>

      {/* Dollar index */}
      <Board title="DOLLAR INDEX" insts={[DXY]} cellBySym={cellBySym} />

      {/* Gold Intelligence: risk regime, correlation grid, COT, central banks */}
      <GoldIntelligence />

      {/* Majors */}
      <Board title="MAJOR PAIRS" insts={MAJORS} cellBySym={cellBySym} />

      {/* Crosses */}
      <Board title="KEY CROSSES" insts={CROSSES} cellBySym={cellBySym} />

      {/* Forex news */}
      <div className="panel min-h-0">
        <div className="panel-header">
          <span>FOREX &amp; MACRO NEWS</span>
          <span className="sub-header normal-case tracking-normal font-normal">yfinance · FX / metals / USD</span>
        </div>
        <div className="max-h-[320px] overflow-auto scroll-thin divide-y divide-term-borderSoft">
          {news.isLoading && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]">Loading headlines…</div>}
          {news.error && <div className="p-3 text-term-red">{(news.error as Error).message}</div>}
          {!news.isLoading && !news.error && (news.data?.length ?? 0) === 0 && (
            <div className="p-3 text-term-muted">No forex headlines right now.</div>
          )}
          {(news.data ?? []).map((n, i) => (
            <a key={n.id + i} href={n.url} target="_blank" rel="noreferrer noopener"
              className="flex items-start gap-3 px-3 py-2 hover:bg-term-amberSubtle group">
              <div className="num text-term-muted w-28 shrink-0">{fmtTime(n.date)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-term-heading group-hover:text-term-amber leading-snug">{n.title}</div>
                <div className="sub-header mt-0.5">{n.source}</div>
              </div>
              <ExternalLink size={12} className="text-term-muted group-hover:text-term-amber mt-1 shrink-0" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
function Board({ title, insts, cellBySym }: {
  title: string;
  insts: Instrument[];
  cellBySym: Map<string, Cell>;
}) {
  const cells = insts.map((i) => cellBySym.get(i.symbol));
  const allLoading = cells.every((c) => c?.isLoading && !c?.candles);
  const allError = cells.every((c) => c?.error);
  const firstError = cells.find((c) => c?.error)?.error;
  const updatedAt = Math.max(0, ...cells.map((c) => c?.updatedAt ?? 0));

  return (
    <div className="panel">
      <div className="panel-header">
        <span>{title}</span>
        <span className="sub-header normal-case tracking-normal font-normal">
          {allError ? "error" : updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString()}` : "20s refresh"}
        </span>
      </div>
      {allError ? (
        <div className="p-4 text-term-red text-[12px]">{firstError?.message ?? "Failed to load quotes."}</div>
      ) : allLoading ? (
        <div className="p-4 text-term-muted uppercase tracking-widest text-[11px]">Loading quotes…</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 p-2">
          {insts.map((inst) => (
            <FxCard key={inst.symbol} inst={inst} cell={cellBySym.get(inst.symbol)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FxCard({ inst, cell, size = "sm" }: {
  inst: Instrument; cell?: Cell; size?: "sm" | "lg";
}) {
  const candles = cell?.candles;
  const s = intradayStats(candles);
  const last = s.last, prev = s.prevClose;
  const chg = last != null && prev != null ? last - prev : undefined;
  const chgPct = chg != null && prev ? (chg / prev) * 100 : undefined;
  const dir = chg == null ? "flat" : chg >= 0 ? "up" : "down";
  const stale = isStale(s.asOf, inst.kind);
  const age = dataAgeMs(s.asOf);
  useStaleBust(inst.symbol, inst.kind, s.asOf, stale);

  const vals = sparkCloses(candles);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pts = vals.length > 1
    ? vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${32 - ((v - min) / (max - min || 1)) * 28}`).join(" ")
    : "";
  const stroke = dir === "up" ? "#22ee22" : dir === "down" ? "#ff3b3b" : "#b45cff";

  return (
    <div className={cn("panel", size === "lg" && "h-full")}>
      <div className="flex items-center justify-between px-2 py-1 border-b border-term-border bg-term-panel2">
        <span className={cn("font-bold tracking-wider flex items-center gap-1", inst.kind === "metal" ? "text-term-amberBright" : "text-term-amber",
          size === "lg" ? "text-[13px]" : "text-[11px]")}>
          {inst.pair}
          {stale && (
            <span title={`Data ${age != null ? fmtAge(age) : "?"} old — feed appears stalled`}
              className="w-1.5 h-1.5 rounded-full bg-term-red shadow-[0_0_4px_rgba(255,59,59,0.8)]" />
          )}
        </span>
        <span className={cn("num", size === "lg" ? "text-[13px]" : "text-[11px]", dir === "up" && "up", dir === "down" && "down")}>
          {fmtPct(chgPct)}
        </span>
      </div>
      <div className="px-2 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("num text-term-heading", size === "lg" ? "text-[26px]" : "text-[16px]")}>
            {last != null ? fmtPrice(last, inst.digits) : candles ? "—" : "…"}
          </div>
          <div className={cn("num text-[11px]", dir === "up" && "up", dir === "down" && "down")}>
            {chg == null ? "" : `${chg >= 0 ? "+" : ""}${fmtPrice(chg, inst.digits)}`}
          </div>
        </div>
        {pts && (
          <svg viewBox="0 0 100 32" className={cn(size === "lg" ? "w-28 h-10" : "w-20 h-8")} preserveAspectRatio="none">
            <polyline fill="none" stroke={stroke} strokeWidth="1.2" points={pts} />
          </svg>
        )}
      </div>
      <div className="px-2 pb-1.5 flex items-center justify-between text-[10px] num text-term-muted">
        <span className="down">L {s.low != null ? fmtPrice(s.low, inst.digits) : "—"}</span>
        <span className="up">H {s.high != null ? fmtPrice(s.high, inst.digits) : "—"}</span>
      </div>
      {size === "lg" && (
        <div className={cn("px-2 pb-1.5 sub-header", stale && "text-term-red")}>
          {s.asOf
            ? stale
              ? `⚠ stale — ${age != null ? fmtAge(age) : "?"} old (last candle ${s.asOf.slice(11, 16)})`
              : `last candle ${s.asOf.slice(11, 16)}`
            : "—"}
        </div>
      )}
    </div>
  );
}
