import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMacroSnapshot, useUsCatalog } from "@/lib/macro/client";
import { SERIES } from "@/lib/macro/config";
import { fmtHeadline, fmtHeadlineDelta } from "@/lib/macro/format";
import { buildView, dateLabel, periodLabel } from "@/lib/macro/math";
import { TOPICS, US_SERIES } from "@/lib/macro/usCatalog";
import { servedLabel } from "@/lib/macro/served";
import type { Observation, SeriesDef, SeriesView } from "@/lib/macro/types";
import { EmptyBlock } from "../research/shared";

// United States, deep coverage: every US series in topic groups. One request (/macro-proxy/us), made only once the
// section is opened (it costs up to 58 FRED requests on a cold server); the six overview rows come from the overview
// snapshot so both views show the same numbers.

export function Spark({ points }: { points: Observation[] }) {
  const pts = points.slice(-48);
  if (pts.length < 2) return <span className="text-term-muted">n/a</span>;
  const w = 84, h = 20, pad = 2;
  const lo = Math.min(...pts.map((p) => p.value)), hi = Math.max(...pts.map((p) => p.value));
  const span = hi - lo || 1;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(pad + (i / (pts.length - 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((p.value - lo) / span) * (h - 2 * pad)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="text-term-amber" aria-label="trend sparkline" role="img">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function UsDeep({ onOpen, selId, enabled, onLoad }: { onOpen: (id: string) => void; selId: string | null; enabled: boolean; onLoad: () => void }) {
  const q = useUsCatalog(enabled);
  const main = useMacroSnapshot();
  const now = useMemo(() => Date.now(), [q.dataUpdatedAt, main.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const views = useMemo(() => {
    const deep = new Map((q.data?.series ?? []).map((s) => [s.id, s]));
    const top = new Map((main.data?.series ?? []).map((s) => [s.id, s]));
    const defs: SeriesDef[] = [...SERIES.filter((d) => d.economy === "US"), ...US_SERIES];
    return defs.map((d) => buildView<SeriesDef>(d, d.indicator ? top.get(d.id) : deep.get(d.id), now));
  }, [q.data, main.data, now]);

  return (
    <div className="flex flex-col gap-2" data-testid="macro-us-deep">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="sub-header">United States: deep coverage</span>
        <span className="text-term-muted text-[11px]">{US_SERIES.length + SERIES.filter((d) => d.economy === "US").length} series from FRED (citing each originating agency), U.S. Treasury FiscalData and the NY Fed. Click any row for its detail view.</span>
        {q.data && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-borderSoft text-term-muted" data-testid="macro-us-served">{servedLabel(q.data)}</span>}
        {enabled && <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber" data-testid="macro-us-refresh"><RefreshCw size={12} className={cn(q.isFetching && "animate-spin")} /></button>}
      </div>
      {!enabled && (
        <button onClick={onLoad} className="self-start px-2 py-1 border border-term-border text-[11px] uppercase tracking-wider text-term-muted hover:text-term-amber hover:border-term-amber" data-testid="macro-us-load">
          Show US deep coverage ({US_SERIES.length} series)
        </button>
      )}
      {enabled && q.isPending && <div className="p-2 text-term-muted uppercase tracking-widest text-[11px]" data-testid="macro-us-loading">Loading US series…</div>}
      {q.isError && (
        <div className="p-2 text-term-red flex flex-col items-start gap-2 text-[12px]" role="alert" data-testid="macro-us-error">
          <div><span className="sub-header text-term-red mr-1">ERROR</span>{(q.error as Error).message}</div>
          <button onClick={() => q.refetch()} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10">Retry</button>
        </div>
      )}
      {q.data && TOPICS.map((t) => {
        const rows = views.filter((v) => v.def.topic === t.id);
        return (
          <div key={t.id} className="flex flex-col gap-1">
            <div className="text-term-heading text-[11px]">{t.name} <span className="text-term-muted">({rows.length})</span></div>
            {rows.length === 0 ? <EmptyBlock>No series in this group.</EmptyBlock> : <Table rows={rows} onOpen={onOpen} selId={selId} />}
          </div>
        );
      })}
    </div>
  );
}

function Table({ rows, onOpen, selId }: { rows: SeriesView<SeriesDef>[]; onOpen: (id: string) => void; selId: string | null }) {
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[980px] text-[12px]">
        <thead>
          <tr className="text-left sub-header border-b border-term-borderSoft">
            <th className="px-2 py-1 font-normal">Indicator</th>
            <th className="px-2 py-1 font-normal text-right">Latest</th>
            <th className="px-2 py-1 font-normal">Observation</th>
            <th className="px-2 py-1 font-normal text-right">Previous</th>
            <th className="px-2 py-1 font-normal text-right">Change</th>
            <th className="px-2 py-1 font-normal">Trend</th>
            <th className="px-2 py-1 font-normal">Status</th>
            <th className="px-2 py-1 font-normal">Source · series id</th>
            <th className="px-2 py-1 font-normal">Published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.def.id} onClick={() => onOpen(v.def.id)} data-testid={`macro-us-row-${v.def.id}`}
              className={cn("border-b border-term-borderSoft cursor-pointer hover:bg-term-amberSubtle align-top", v.def.id === selId && "bg-term-amberSubtle")}>
              <td className="px-2 py-1"><div className="text-term-heading">{v.def.name ?? v.def.label}</div><div className="text-term-muted text-[10px]">{v.def.basis}</div></td>
              {v.errorKind === "pending" ? (
                <td colSpan={5} className="px-2 py-1 text-term-muted text-[11px]" data-testid="macro-us-pending" title={v.error}>Still loading… the source has not answered yet; this table refreshes itself when it does.</td>
              ) : v.error || !v.latest ? (
                <td colSpan={5} className="px-2 py-1 text-term-red text-[11px]">Unavailable: {v.error ?? "no value"}</td>
              ) : (
                <>
                  <td className="px-2 py-1 text-right num text-term-heading whitespace-nowrap">{fmtHeadline(v.def, v.latest.value)}</td>
                  <td className="px-2 py-1 num whitespace-nowrap">{periodLabel(v.latest.period)}</td>
                  <td className="px-2 py-1 text-right num text-term-muted whitespace-nowrap">{v.previous ? fmtHeadline(v.def, v.previous.value) : "n/a"}</td>
                  <td className="px-2 py-1 text-right num whitespace-nowrap">{fmtHeadlineDelta(v.def, v.change)}</td>
                  <td className="px-2 py-1"><Spark points={v.points} /></td>
                </>
              )}
              <td className="px-2 py-1">
                <div className="flex gap-1 flex-wrap">
                  {v.staleCache && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber" data-testid="macro-stale-cache-chip" title={`Cached copy retrieved ${new Date(v.staleCache.fetchedAt).toLocaleString("en-US")}, past its refresh interval. ${v.staleCache.refreshing ? "A refresh is running in the background." : "Its source is failing."}`}>STALE CACHE</span>}
                  {v.freshness?.state === "stale" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber" data-testid="macro-stale-chip" title={`Older than expected: ${v.freshness.ageDays} days; expected at most ${v.freshness.lagDays}.`}>STALE</span>}
                  {v.freshness?.state === "hidden" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber" title={`More than twice its expected lag: ${v.freshness.ageDays} days`}>TOO OLD</span>}
                  {v.computed && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber" title="Derived by this terminal from the published series">computed</span>}
                  {v.freshness?.state === "fresh" && !v.computed && <span className="text-term-muted text-[10px]">{v.freshness.ageDays} d old</span>}
                </div>
              </td>
              <td className="px-2 py-1 text-term-muted text-[11px] max-w-[260px]">{v.def.agency ?? v.def.provider}<div className="text-[10px]">{v.def.adapter === "fred" ? `FRED ${v.def.code}` : v.def.adapter === "fiscaldata" ? "FiscalData API" : "NY Fed SCE workbook"}</div></td>
              <td className="px-2 py-1 text-term-muted whitespace-nowrap num">{dateLabel(v.refreshedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
