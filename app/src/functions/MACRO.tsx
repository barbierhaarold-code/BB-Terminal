import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, LineStyle, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { baseChartOptions, crosshairOptions, useChartTheme } from "@/lib/chartTheme";
import { useMacroSnapshot } from "@/lib/macro/client";
import { ECONOMIES, ECONOMY_NAME, INDICATORS, INDICATOR_NAME, SERIES, STALE_RULE_TEXT } from "@/lib/macro/config";
import {
  MIN_ECONOMIES_FOR_COMPARISON, REAL_RATE_LABEL, buildViews, dateLabel, fmtChange, fmtValue, periodEnd, periodLabel, type MacroViews,
} from "@/lib/macro/math";
import type { Economy, Indicator, Observation, RealRate, SeriesView } from "@/lib/macro/types";
import { DataNote, EmptyBlock } from "./research/shared";

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text focus:outline-none focus:border-term-amber";

export function MACRO() {
  const q = useMacroSnapshot();
  const snap = q.data;
  // Ages are measured against the browser clock at the moment the data was last received, so a tab left open
  // keeps flagging staleness on refetch and never freezes at "fresh".
  const views = useMemo(() => buildViews(snap, Date.now()), [snap, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [econ, setEcon] = useState<Economy | "all">("all");
  const [ind, setInd] = useState<Indicator | "all">("all");
  const [selId, setSelId] = useState<string | null>(null);

  const rows = views.shown.filter((v) => (econ === "all" || v.def.economy === econ) && (ind === "all" || v.def.indicator === ind));
  const selected = views.shown.find((v) => v.def.id === selId) ?? null;

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">MACRO HUB</span>
            <span className="text-term-muted text-[11px]">G8 macro data via DBnomics · descriptive · monthly to quarterly, not live</span>
          </div>
          {snap && <StatusLine fetchedAt={snap.fetchedAt} cacheState={snap.cacheState} />}
        </div>
        <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5" data-testid="macro-refresh">
          <RefreshCw size={13} className={cn(q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.isPending && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]" data-testid="macro-loading">Loading macro data…</div>}
      {q.isError && !q.isPending && <MacroError error={q.error} onRetry={() => q.refetch()} fetching={q.isFetching} />}
      {snap && snap.cacheState === "STALE" && <Banner testid="macro-stale-cache">{snap.warnings[0]}</Banner>}

      {snap && (
        <>
          <Overview views={views} rows={rows} econ={econ} setEcon={setEcon} ind={ind} setInd={setInd} selId={selId} onSelect={setSelId} />
          {selected && <Detail v={selected} />}
          <RealRatePanel views={views} />
          <CoverageGaps views={views} />
        </>
      )}

      <Sources />
      <About />
    </div>
  );
}

// ───────────── status + states ─────────────

function StatusLine({ fetchedAt, cacheState }: { fetchedAt: string; cacheState: string }) {
  const t = new Date(fetchedAt);
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]" data-testid="macro-status">
      <span className="num text-term-text">Retrieved {t.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-borderSoft text-term-muted">DBnomics · server cache {cacheState}</span>
      <span className="text-term-muted">Each figure carries its own observation period; none is a live quote.</span>
    </div>
  );
}

function Banner({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className="flex items-start gap-2 border border-term-amber/60 bg-term-amberSubtle px-2 py-1 text-[11px] leading-snug text-term-text">
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-term-amber" />
      <span>{children}</span>
    </div>
  );
}

function MacroError({ error, onRetry, fetching }: { error: unknown; onRetry: () => void; fetching?: boolean }) {
  return (
    <div className="p-3 text-term-red flex flex-col items-start gap-2 text-[12px]" role="alert" data-testid="macro-error">
      <div><span className="sub-header text-term-red mr-1">ERROR</span>{(error as Error)?.message ?? "Macro data unavailable."}</div>
      <button onClick={onRetry} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
        <RefreshCw size={11} className={cn(fetching && "animate-spin")} /> Retry
      </button>
    </div>
  );
}

// ───────────── overview table ─────────────

function Spark({ points }: { points: Observation[] }) {
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

function Chip({ children, title, testid }: { children: React.ReactNode; title?: string; testid?: string }) {
  return <span title={title} data-testid={testid} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber whitespace-nowrap">{children}</span>;
}

function Overview(p: {
  views: MacroViews; rows: SeriesView[]; econ: Economy | "all"; setEcon: (e: Economy | "all") => void;
  ind: Indicator | "all"; setInd: (i: Indicator | "all") => void; selId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="sub-header">Overview</span>
        <select value={p.econ} onChange={(e) => p.setEcon(e.target.value as Economy | "all")} className={inputCls} aria-label="Filter by economy" data-testid="macro-filter-economy">
          <option value="all">All economies</option>
          {ECONOMIES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={p.ind} onChange={(e) => p.setInd(e.target.value as Indicator | "all")} className={inputCls} aria-label="Filter by indicator" data-testid="macro-filter-indicator">
          <option value="all">All indicators</option>
          {INDICATORS.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <span className="text-term-muted text-[11px]">{p.views.shown.length} series shown · {p.views.gaps.length} cells not available (see Coverage gaps)</span>
      </div>

      {p.views.shown.length === 0 ? (
        <EmptyBlock>No series passed the freshness rule. See Coverage gaps below for why.</EmptyBlock>
      ) : p.rows.length === 0 ? (
        <EmptyBlock>No series match this filter.</EmptyBlock>
      ) : (
        <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
          <table className="w-full min-w-[980px] text-[12px]" data-testid="macro-table">
            <thead>
              <tr className="text-left sub-header border-b border-term-borderSoft">
                <th className="px-2 py-1.5 font-normal">Economy</th>
                <th className="px-2 py-1.5 font-normal">Indicator</th>
                <th className="px-2 py-1.5 font-normal text-right">Latest</th>
                <th className="px-2 py-1.5 font-normal">Observation</th>
                <th className="px-2 py-1.5 font-normal text-right">Previous</th>
                <th className="px-2 py-1.5 font-normal text-right">Change</th>
                <th className="px-2 py-1.5 font-normal">Trend</th>
                <th className="px-2 py-1.5 font-normal">Status</th>
                <th className="px-2 py-1.5 font-normal">Provider</th>
                <th className="px-2 py-1.5 font-normal">DBnomics refreshed</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((v) => {
                const d = v.def.decimals, active = v.def.id === p.selId;
                return (
                  <tr key={v.def.id} onClick={() => p.onSelect(v.def.id)} data-testid={`macro-row-${v.def.id}`}
                    className={cn("border-b border-term-borderSoft cursor-pointer hover:bg-term-amberSubtle", active && "bg-term-amberSubtle")}>
                    <td className="px-2 py-1.5 text-term-heading whitespace-nowrap">{ECONOMY_NAME[v.def.economy]}</td>
                    <td className="px-2 py-1.5"><div>{INDICATOR_NAME[v.def.indicator]}</div><div className="text-term-muted text-[10px]">{v.def.label} · {v.def.basis}</div></td>
                    <td className="px-2 py-1.5 text-right num text-term-heading">{fmtValue(v.latest!.value, d)}%{v.def.valueNote && <div className="text-[10px] text-term-muted font-normal max-w-[280px] ml-auto leading-snug" data-testid="macro-value-note">{v.def.valueNote}</div>}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap num">{periodLabel(v.latest!.period)}<div className="text-term-muted text-[10px]">{v.def.frequency}{v.def.kind === "step" ? " · date rate took effect" : ""}</div></td>
                    <td className="px-2 py-1.5 text-right num text-term-muted">{v.previous ? <>{fmtValue(v.previous.value, d)}%<div className="text-[10px]">{periodLabel(v.previous.period)}</div></> : "n/a"}</td>
                    <td className="px-2 py-1.5 text-right num">{fmtChange(v.change, d)}</td>
                    <td className="px-2 py-1.5"><Spark points={v.points} /></td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1 flex-wrap">
                        {v.freshness?.state === "stale" && (
                          <Chip testid="macro-stale-chip" title={`Older than expected: ${v.freshness.ageDays} days since ${v.freshness.basis === "refresh" ? "DBnomics last refreshed it" : "the end of the period"}; expected at most ${v.freshness.lagDays}.`}>STALE</Chip>
                        )}
                        {v.computed && <Chip title="Year-on-year change computed by this terminal from the provider's published index.">computed</Chip>}
                        {v.freshness?.state === "fresh" && !v.computed && <span className="text-term-muted text-[10px]">{v.freshness.ageDays} d old</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-term-muted max-w-[200px]">{v.provider}</td>
                    <td className="px-2 py-1.5 text-term-muted whitespace-nowrap num">{dateLabel(v.refreshedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-term-muted">Click a row for its history. Changes are plain differences versus the previous observation; no value is colour-coded. Stale rule: see below the table.</div>
      <div className="text-[10px] text-term-muted" data-testid="macro-stale-rule"><b className="text-term-text">STALE rule.</b> {STALE_RULE_TEXT}</div>
    </div>
  );
}

// ───────────── detail + chart ─────────────

const RANGE_BY_FREQ: Record<string, { label: string; n: number }[]> = {
  daily: [{ label: "1Y", n: 260 }, { label: "3Y", n: 780 }, { label: "MAX", n: Infinity }],
  monthly: [{ label: "5Y", n: 60 }, { label: "10Y", n: 120 }, { label: "MAX", n: Infinity }],
  quarterly: [{ label: "5Y", n: 20 }, { label: "10Y", n: 40 }, { label: "MAX", n: Infinity }],
};

function Detail({ v }: { v: SeriesView }) {
  const ranges = RANGE_BY_FREQ[v.def.frequency];
  const [range, setRange] = useState(ranges[1]);
  const [hover, setHover] = useState<string | null>(null);
  const d = v.def.decimals;
  useEffect(() => { setRange(RANGE_BY_FREQ[v.def.frequency][1]); setHover(null); }, [v.def.id, v.def.frequency]);
  return (
    <div className="border border-term-borderSoft flex flex-col" data-testid="macro-detail">
      <div className="px-3 py-2 border-b border-term-borderSoft flex flex-col gap-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-term-heading">{ECONOMY_NAME[v.def.economy]} · {INDICATOR_NAME[v.def.indicator]}</span>
          <span className="text-term-muted text-[11px]">{v.def.label} · {v.def.basis}</span>
          {v.freshness?.state === "stale" && <Chip>STALE</Chip>}
          {v.computed && <Chip>computed</Chip>}
        </div>
        <div className="text-[11px] num text-term-text" data-testid="macro-freshness-line">
          Latest observation {periodLabel(v.latest!.period)}: {fmtValue(v.latest!.value, d)}%
          {v.previous && <> · previous {periodLabel(v.previous.period)}: {fmtValue(v.previous.value, d)}% · change {fmtChange(v.change, d)}</>}
          {v.def.valueNote && <span className="text-term-muted" data-testid="macro-detail-note"> ({v.def.valueNote})</span>}
          {" "}· provider: {v.provider} · DBnomics last refreshed: {dateLabel(v.refreshedAt)}
          {v.freshness && <> · age {v.freshness.ageDays} d (expected ≤ {v.freshness.lagDays} d, {v.freshness.basis === "refresh" ? "from refresh date" : "from period end"})</>}
        </div>
        <div className="text-[10px] text-term-muted">{v.def.attribution}.{" "}
          <a href={v.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber">Series on DBnomics</a>{" "}
          · Series code {v.def.code} · {v.def.licenceNote} · Lag rule: {v.def.lag.why}.
        </div>
      </div>
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-term-borderSoft">
        {ranges.map((r) => (
          <button key={r.label} onClick={() => setRange(r)}
            className={cn("px-2 py-0.5 border text-[10px] uppercase tracking-wider", range.label === r.label ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-amber")}>{r.label}</button>
        ))}
        <span className="num text-[11px] text-term-text ml-2" data-testid="macro-hover">{hover ?? "Hover the chart for a period's value"}</span>
      </div>
      <div className="relative h-[260px]">
        <HistoryChart v={v} n={range.n} onHover={setHover} />
      </div>
    </div>
  );
}

function HistoryChart({ v, n, onHover }: { v: SeriesView; n: number; onHover: (s: string | null) => void }) {
  const ct = useChartTheme();
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const d = v.def.decimals;
  const byTime = useRef(new Map<string, Observation>());

  const data = useMemo(() => {
    const slice = Number.isFinite(n) ? v.points.slice(-n) : v.points;
    byTime.current = new Map(slice.map((p) => [periodEnd(p.period), p]));
    return slice.map((p) => ({ time: periodEnd(p.period), value: p.value }));
  }, [v.points, n]);

  useEffect(() => {
    if (!ref.current) return;
    const base = baseChartOptions(ct);
    const chart = createChart(ref.current, {
      ...base,
      localization: { locale: "en-US" }, // English month labels regardless of browser locale
      timeScale: { ...base.timeScale, timeVisible: false },
      crosshair: {
        vertLine: { ...crosshairOptions(ct).vertLine, width: 1, style: LineStyle.Dashed },
        horzLine: { ...crosshairOptions(ct).horzLine, width: 1, style: LineStyle.Dashed },
      },
      autoSize: true,
    });
    const s = chart.addLineSeries({
      color: ct.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (x: number) => `${fmtValue(x, d)}%`, minMove: 0.01 },
    });
    chart.subscribeCrosshairMove((p) => {
      const t = typeof p.time === "string" ? p.time : null;
      const o = t ? byTime.current.get(t) : undefined;
      onHover(o ? `${periodLabel(o.period)}: ${fmtValue(o.value, d)}%` : null);
    });
    chartRef.current = chart; seriesRef.current = s;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.def.id]);

  useEffect(() => {
    chartRef.current?.applyOptions({ ...baseChartOptions(ct), crosshair: { vertLine: crosshairOptions(ct).vertLine, horzLine: crosshairOptions(ct).horzLine } });
    seriesRef.current?.applyOptions({ color: ct.accent });
  }, [ct]);

  useEffect(() => {
    seriesRef.current?.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={ref} className="absolute inset-0" data-testid="macro-chart" />;
}

// ───────────── real policy rate ─────────────

type SortKey = "economy" | "real" | "policy" | "cpi";

function RealRatePanel({ views }: { views: MacroViews }) {
  const ok = views.realRates.filter((r) => r.ok);
  const bad = views.realRates.filter((r) => !r.ok);
  const showComparison = ok.length >= MIN_ECONOMIES_FOR_COMPARISON;
  return (
    <div className="flex flex-col gap-2" data-testid="macro-realrate">
      <span className="sub-header">Real policy rate</span>
      <div className="text-[11px] text-term-muted">{REAL_RATE_LABEL}. Inputs have different frequencies and observation dates; both are shown and nothing is aligned or interpolated.</div>
      {ok.length === 0 ? (
        <EmptyBlock>No economy has a fresh policy rate and a fresh CPI at the same time.</EmptyBlock>
      ) : showComparison ? (
        <Comparison rows={ok} />
      ) : (
        <RealRateTable rows={ok} />
      )}
      {!showComparison && (
        <div className="text-[11px] text-term-text border border-term-borderSoft bg-term-panel2 px-3 py-2" data-testid="macro-comparison-gate">
          A cross-economy comparison (policy rate vs CPI vs real policy rate, sortable) is only shown when at least {MIN_ECONOMIES_FOR_COMPARISON} economies qualify. Today {ok.length} of 8 do, so it is not shown; the gaps that prevent it are listed here and in Coverage gaps.
        </div>
      )}
      {bad.length > 0 && (
        <ul className="text-[11px] text-term-muted grid gap-0.5 sm:grid-cols-2">
          {bad.map((r) => <li key={r.economy}><span className="text-term-text">{ECONOMY_NAME[r.economy]}</span>: not computed — {why(r, views)}</li>)}
        </ul>
      )}
    </div>
  );
}

function why(r: RealRate, views: MacroViews): string {
  const p = views.gaps.find((g) => g.economy === r.economy && g.indicator === "policy_rate");
  const c = views.gaps.find((g) => g.economy === r.economy && g.indicator === "cpi_yoy");
  const parts = [p && "no usable policy rate", c && "no usable CPI"].filter(Boolean);
  return parts.length ? parts.join(" and ") : r.reason ?? "inputs unavailable";
}

function RealRateTable({ rows }: { rows: RealRate[] }) {
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[640px] text-[12px]" data-testid="macro-realrate-table">
        <thead><tr className="text-left sub-header border-b border-term-borderSoft">
          <th className="px-2 py-1.5 font-normal">Economy</th><th className="px-2 py-1.5 font-normal text-right">Real policy rate</th>
          <th className="px-2 py-1.5 font-normal">Policy rate (observation)</th><th className="px-2 py-1.5 font-normal">CPI YoY (observation)</th>
        </tr></thead>
        <tbody>{rows.map((r) => <RealRow key={r.economy} r={r} />)}</tbody>
      </table>
    </div>
  );
}

function RealRow({ r }: { r: RealRate }) {
  return (
    <tr className="border-b border-term-borderSoft">
      <td className="px-2 py-1.5 text-term-heading">{ECONOMY_NAME[r.economy]}</td>
      <td className="px-2 py-1.5 text-right num text-term-heading">{fmtValue(r.value, 2)}% <Chip>computed</Chip></td>
      <td className="px-2 py-1.5 num">{fmtValue(r.policy!.value, 2)}% <span className="text-term-muted">· {periodLabel(r.policy!.period)} · {r.policy!.frequency}</span></td>
      <td className="px-2 py-1.5 num">{fmtValue(r.cpi!.value, 1)}% <span className="text-term-muted">· {periodLabel(r.cpi!.period)} · {r.cpi!.frequency}</span></td>
    </tr>
  );
}

/** Only mounted when at least MIN_ECONOMIES_FOR_COMPARISON economies qualify. Neutral styling: sorting never implies good or bad. */
function Comparison({ rows }: { rows: RealRate[] }) {
  const [key, setKey] = useState<SortKey>("economy");
  const [dir, setDir] = useState<1 | -1>(1);
  const sorted = [...rows].sort((a, b) => {
    const f = (r: RealRate) => (key === "economy" ? ECONOMY_NAME[r.economy] : key === "real" ? r.value! : key === "policy" ? r.policy!.value : r.cpi!.value);
    const x = f(a), y = f(b);
    return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
  });
  const head = (k: SortKey, label: string, right = false) => (
    <th className={cn("px-2 py-1.5 font-normal cursor-pointer hover:text-term-amber", right && "text-right")} onClick={() => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(1); } }}>
      {label}{key === k ? (dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[640px] text-[12px]" data-testid="macro-comparison">
        <thead><tr className="text-left sub-header border-b border-term-borderSoft">
          {head("economy", "Economy")}{head("policy", "Policy rate", true)}{head("cpi", "CPI YoY", true)}{head("real", "Real policy rate", true)}
          <th className="px-2 py-1.5 font-normal">Observation dates</th>
        </tr></thead>
        <tbody>{sorted.map((r) => (
          <tr key={r.economy} className="border-b border-term-borderSoft">
            <td className="px-2 py-1.5 text-term-heading">{ECONOMY_NAME[r.economy]}</td>
            <td className="px-2 py-1.5 text-right num">{fmtValue(r.policy!.value, 2)}%</td>
            <td className="px-2 py-1.5 text-right num">{fmtValue(r.cpi!.value, 1)}%</td>
            <td className="px-2 py-1.5 text-right num text-term-heading">{fmtValue(r.value, 2)}% <Chip>computed</Chip></td>
            <td className="px-2 py-1.5 text-term-muted num">{periodLabel(r.policy!.period)} · {periodLabel(r.cpi!.period)}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── coverage gaps ─────────────

const GAP_KIND: Record<string, string> = {
  no_series: "No licensed fresh series", excluded_provider: "Provider excluded", stale_mirror: "Stale mirror", not_pinned: "Not wired in v1", fetch_error: "Fetch problem", too_old: "Too old to show",
};

function CoverageGaps({ views }: { views: MacroViews }) {
  const byEcon = ECONOMIES.map((e) => ({ e, gaps: views.gaps.filter((g) => g.economy === e.id) })).filter((x) => x.gaps.length > 0);
  return (
    <details open className="border border-term-borderSoft" data-testid="macro-gaps">
      <summary className="px-3 py-2 cursor-pointer sub-header select-none">Coverage gaps — {views.gaps.length} of 48 economy × indicator cells have no series shown</summary>
      <div className="px-3 pb-3 flex flex-col gap-3">
        <div className="text-[11px] text-term-muted">Every missing cell and why. Nothing here is estimated, interpolated or filled from another source.</div>
        {byEcon.map(({ e, gaps }) => (
          <div key={e.id}>
            <div className="text-term-heading text-[11px] mb-1">{e.name} <span className="text-term-muted">({gaps.length})</span></div>
            <table className="w-full text-[11px]"><tbody>
              {gaps.map((g) => (
                <tr key={g.indicator} className="border-t border-term-borderSoft align-top">
                  <td className="py-1 pr-3 whitespace-nowrap w-[170px]">{INDICATOR_NAME[g.indicator]}</td>
                  <td className="py-1 pr-3 whitespace-nowrap w-[160px] text-term-muted">{GAP_KIND[g.kind]}</td>
                  <td className="py-1 text-term-muted">{g.reason}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
      </div>
    </details>
  );
}

// ───────────── sources + about ─────────────

function Sources() {
  const unique = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of SERIES) if (!m.has(s.attribution)) m.set(s.attribution, s.licenceNote);
    return [...m];
  }, []);
  return (
    <div className="border border-term-borderSoft px-3 py-2 text-[10px] text-term-muted leading-relaxed" data-testid="macro-sources">
      <div className="sub-header mb-1">Sources and licences</div>
      <div className="mb-1">DBnomics (db.nomics.world) is a free open aggregator: it redistributes each provider's data as-is, without changing values, so freshness depends on each provider and on when DBnomics last mirrored it.</div>
      <ul className="grid gap-0.5">
        {unique.map(([a, l]) => <li key={a}>{a}. <span className="opacity-80">{l}</span></li>)}
      </ul>
    </div>
  );
}

function About() {
  return (
    <DataNote>
      <p className="mb-1.5">
        <b>What this is.</b> A reference page of published macroeconomic statistics for a few large economies, pulled from DBnomics. It is <b>descriptive context, not a prediction</b>:
        nothing here forecasts, scores or signals anything, and values are never coloured as good or bad.
      </p>
      <p className="mb-1.5">
        <b>Why the dates lag.</b> Statistics describe a past period and are published afterwards: inflation roughly two to three weeks after the month ends, unemployment from about four weeks (Australia) to two and a half months (UK),
        GDP one to three months after the quarter ends, and they are often revised later. Central-bank rates and bond yields are daily, but DBnomics mirrors them with its own delay.
        So a figure marked "Aug 2026" is an August number, not today's; always read the observation period beside the value.
      </p>
      <p className="mb-1.5">
        <b>Indicators.</b> <b>Policy rate</b>: the central bank's main interest rate (US shows interest on reserves, an administered rate; Australia's cash rate target changes only at meetings, so its date is the date the rate took effect).
        <b> CPI inflation (YoY)</b>: change in consumer prices versus the same period a year earlier; where a provider publishes only the index (Japan), the year-on-year change is computed here and labelled "computed". Because the index is rounded to one decimal, a computed figure can differ from the statistics office's own year-on-year by about 0.1 percentage point.
        <b> Core CPI</b>: the same excluding the most volatile items (definitions differ by country: Japan excludes fresh food and energy, Australia uses the trimmed mean).
        <b> Unemployment rate</b>: share of the labour force without work and seeking it. <b>Real GDP growth</b>: change in inflation-adjusted output; the basis differs by country (US quarter-on-quarter annualised, UK quarter-on-quarter, Euro Area and Australia year-on-year) and the basis is shown on each row, so rows are not directly comparable.
        <b> 10Y yield</b>: the yield on 10-year government bonds.
      </p>
      <p className="mb-1.5">
        <b>Real policy rate</b> (computed: policy rate minus CPI YoY, latest available of each) mixes a daily or step rate with a monthly or quarterly CPI. It is shown only when both inputs are fresh, with both observation dates; it describes the gap between two published numbers, not a measure of how tight policy is.
      </p>
      <p>
        <b>Coverage.</b> Many central banks and statistics offices are not on DBnomics, or their DBnomics mirror is months behind, or their terms of use do not allow redistribution here. Those cells are listed under Coverage gaps instead of being shown empty or estimated. PMI and other proprietary series are not included.
      </p>
    </DataNote>
  );
}
