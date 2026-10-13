import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { Download, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { baseChartOptions, crosshairOptions, useChartTheme } from "@/lib/chartTheme";
import { ALL_BY_ID, seriesName } from "@/lib/macro/catalog";
import { ECONOMY_NAME, INDICATOR_NAME } from "@/lib/macro/config";
import { useMacroDetail } from "@/lib/macro/client";
import {
  TRANSFORM_LABEL, chartSeries, headlineTransform, windowStats,
  type AssetReaction, type MacroDetail, type ReactionResult, type Revisions, type WindowStats,
} from "@/lib/macro/detail";
import { GLOSSARY, explanationOf, type Explanation, type GlossaryId } from "@/lib/macro/explain";
import { fmtDelta, fmtHeadline, fmtHeadlineDelta, fmtIn, transformDecimals, transformUnit } from "@/lib/macro/format";
import { applyHeadline, assessFreshness, dateLabel, latestTwo, periodEnd, periodLabel } from "@/lib/macro/math";
import { RANGES, type RangeKey } from "@/lib/macro/urlState";
import { docItems } from "@/lib/macro/docs";
import { usePolicyFeed } from "@/lib/policy/client";
import type { ChartTransform, Observation, SeriesDef } from "@/lib/macro/types";

// The indicator detail view: one closable panel, sections a–h. Every number shows its source, series id,
// observation period and release/update date; what is not available says so, with the reason.

export interface DetailState { id: string; transform: ChartTransform | null; range: RangeKey | null; overlay: string | null }

const RANGE_YEARS: Record<RangeKey, number | null> = { "1Y": 1, "5Y": 5, "10Y": 10, MAX: null };
const btn = (active: boolean) => cn("px-2 py-0.5 border text-[10px] uppercase tracking-wider", active ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-amber");

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-term-borderSoft pt-2" data-testid={`macro-detail-${id}`} aria-labelledby={`mds-${id}`}>
      <h3 id={`mds-${id}`} className="sub-header">{title}</h3>
      {children}
    </section>
  );
}

function NotAvailable({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-term-muted" data-testid="macro-not-available"><b className="text-term-text">Not available.</b> {children}</div>;
}

export function DetailPanel({ state, onChange, onClose }: { state: DetailState; onChange: (s: Partial<DetailState>) => void; onClose: () => void }) {
  const def = ALL_BY_ID[state.id];
  const q = useMacroDetail(def ? state.id : null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [state.id]);

  const name = def ? seriesName(def, INDICATOR_NAME) : state.id;
  return (
    <aside ref={ref} role="dialog" aria-label={`${name} detail`} data-testid="macro-detail"
      className="absolute inset-y-0 right-0 z-30 w-full max-w-[820px] bg-term-panel border-l border-term-border shadow-panel overflow-y-auto scroll-thin text-[12px]">
      <div className="sticky top-0 z-10 bg-term-panel border-b border-term-border px-3 py-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-term-amber font-semibold">{def ? ECONOMY_NAME[def.economy] : "Unknown indicator"}</div>
          <div className="text-term-heading text-[13px] truncate" data-testid="macro-detail-name">{name}</div>
        </div>
        {q.data && <button onClick={() => q.refetch()} title="Reload" className="text-term-muted hover:text-term-amber mt-1"><RefreshCw size={12} className={cn(q.isFetching && "animate-spin")} /></button>}
        <button onClick={onClose} aria-label="Close detail view" title="Close (Esc)" className="text-term-muted hover:text-term-amber mt-1" data-testid="macro-detail-close"><X size={14} /></button>
      </div>
      <div className="p-3 flex flex-col gap-3">
        {!def ? (
          <div className="text-term-red" role="alert">Unknown indicator id "{state.id}". The link may be out of date.</div>
        ) : q.isPending ? (
          <div className="text-term-muted uppercase tracking-widest text-[11px]" data-testid="macro-detail-loading">Loading full history, revisions and release calendar…</div>
        ) : q.isError ? (
          <div className="text-term-red flex flex-col items-start gap-2" role="alert" data-testid="macro-detail-error">
            <div><span className="sub-header text-term-red mr-1">ERROR</span>{(q.error as Error).message}</div>
            <button onClick={() => q.refetch()} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
              <RefreshCw size={11} className={cn(q.isFetching && "animate-spin")} /> Retry
            </button>
          </div>
        ) : q.data.history.length === 0 ? (
          <div className="text-term-muted" data-testid="macro-detail-empty">The source returned no observations for this series.</div>
        ) : (
          <Body def={def} d={q.data} state={state} onChange={onChange} />
        )}
      </div>
    </aside>
  );
}

function Body({ def, d, state, onChange }: { def: SeriesDef; d: MacroDetail; state: DetailState; onChange: (s: Partial<DetailState>) => void }) {
  const expl = explanationOf(def);
  const headline = useMemo(() => applyHeadline(d.history, def.transform, def.frequency), [d.history, def]);
  const { latest, previous } = latestTwo(headline);
  const fresh = latest ? assessFreshness(def, latest.period, d.refreshedAt, Date.now()) : null;
  return (
    <>
      <Header def={def} d={d} latest={latest} previous={previous} fresh={fresh} expl={expl} />
      <ChartSection def={def} d={d} state={state} onChange={onChange} />
      <StatsSection def={def} headline={headline} />
      <RevisionsSection def={def} d={d} />
      <ExplanationSection expl={expl} />
      <RelatedSection def={def} onOpen={(id) => onChange({ id, transform: null, overlay: null })} />
      <DocsSection def={def} d={d} expl={expl} />
      <ReactionSection d={d} />
      {d.warnings.length > 0 && <div className="text-[10px] text-term-muted">{d.warnings.join(" · ")}</div>}
    </>
  );
}

// ───────────── a. header ─────────────

function Header({ def, d, latest, previous, fresh, expl }: { def: SeriesDef; d: MacroDetail; latest: Observation | null; previous: Observation | null; fresh: ReturnType<typeof assessFreshness>; expl: Explanation | null }) {
  const change = latest && previous ? latest.value - previous.value : null;
  const ids = def.adapter === "fred" ? `FRED ${def.code}` : `${def.code}`;
  return (
    <Section id="header" title="a. Latest">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="num text-[22px] text-term-heading" data-testid="macro-detail-latest">{latest ? fmtHeadline(def, latest.value) : "n/a"}</span>
        <span className="num text-term-text">{latest ? periodLabel(latest.period) : ""}</span>
        {fresh?.state === "stale" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber" title={`Older than expected: ${fresh.ageDays} days; expected at most ${fresh.lagDays}.`}>STALE</span>}
        {def.transform !== "none" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber" title="Derived by this terminal from the published series">computed</span>}
      </div>
      <div className="text-[11px] text-term-muted">{def.label} · {def.basis}{def.valueNote ? ` · ${def.valueNote}` : ""}</div>
      <table className="text-[11px] num w-full" data-testid="macro-detail-facts"><tbody>
        <Fact k="Previous">{previous ? `${fmtHeadline(def, previous.value)} (${periodLabel(previous.period)})` : "not available: only one observation"}</Fact>
        <Fact k="Change">{fmtHeadlineDelta(def, change)}</Fact>
        <Fact k="Observation period">{latest ? `${periodLabel(latest.period)} (${def.frequency}${def.kind === "step" ? ", date the rate took effect" : ""})` : "n/a"}</Fact>
        <Fact k="Published / updated at source">{d.refreshedAt ? dateLabel(d.refreshedAt) : "not available: the source gives no publication date for this series"}</Fact>
        <Fact k="Next scheduled release">
          {d.release?.next ? <span data-testid="macro-detail-next">{dateLabel(d.release.next)} <span className="text-term-muted">({d.release.nextNote})</span></span>
            : d.release ? <span className="text-term-muted">{d.release.nextNote}{expl && <> See <a className="underline hover:text-term-amber" href={expl.calendar.url} target="_blank" rel="noreferrer noopener">{expl.calendar.label}</a>.</>}</span>
            : expl ? <span className="text-term-muted">No machine-readable release calendar is used for this source; see the official calendar: <a className="underline hover:text-term-amber" href={expl.calendar.url} target="_blank" rel="noreferrer noopener">{expl.calendar.label}</a>.</span>
            : "not available"}
        </Fact>
        <Fact k="Status">{fresh ? `${fresh.state === "stale" ? "STALE" : "fresh"}: ${fresh.ageDays} days since ${fresh.basis === "refresh" ? "the source's refresh" : "the end of the period"} (expected at most ${fresh.lagDays}; ${def.lag.why})` : "not available"}</Fact>
        <Fact k="Provider">{d.provider}{def.agency && !d.provider.includes(def.agency) ? ` · originating agency: ${def.agency}` : ""}</Fact>
        <Fact k="Series id">{ids}</Fact>
        <Fact k="Source">{d.sourceUrl ? <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber break-all">{d.sourceUrl}</a> : "not available"}</Fact>
      </tbody></table>
      <div className="text-[10px] text-term-muted">{def.attribution}. {def.licenceNote}{d.fredMeta ? ` FRED metadata: "${d.fredMeta.title}", ${d.fredMeta.units}, ${d.fredMeta.seasonalAdjustment}, last updated ${d.fredMeta.lastUpdated}.` : ""}</div>
    </Section>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return <tr className="align-top"><td className="pr-3 py-0.5 text-term-muted whitespace-nowrap w-[200px]">{k}</td><td className="py-0.5 text-term-text">{children}</td></tr>;
}

// ───────────── b. chart ─────────────

function cut(points: Observation[], years: number | null): Observation[] {
  if (years == null || points.length === 0) return points;
  const end = Date.parse(`${periodEnd(points[points.length - 1].period)}T00:00:00Z`);
  const from = end - years * 365.25 * 86_400_000;
  return points.filter((p) => Date.parse(`${periodEnd(p.period)}T00:00:00Z`) > from);
}

function ChartSection({ def, d, state, onChange }: { def: SeriesDef; d: MacroDetail; state: DetailState; onChange: (s: Partial<DetailState>) => void }) {
  const options = useMemo(() => {
    const list = [...(def.chart ?? ["level"])];
    const h = headlineTransform(def.transform);
    if (!list.includes(h)) list.unshift(h);
    return list;
  }, [def]);
  const transform: ChartTransform = state.transform && options.includes(state.transform) ? state.transform : headlineTransform(def.transform);
  const range: RangeKey = state.range ?? (def.frequency === "daily" ? "5Y" : "10Y");
  const overlayDef = state.overlay ? ALL_BY_ID[state.overlay] : null;
  const ov = useMacroDetail(overlayDef && state.overlay !== def.id ? state.overlay : null);

  const main = useMemo(() => cut(chartSeries(d.history, transform, def.frequency), RANGE_YEARS[range]), [d.history, transform, def.frequency, range]);
  const overlay = useMemo(() => {
    if (!overlayDef || !ov.data || main.length === 0) return [];
    const pts = applyHeadline(ov.data.history, overlayDef.transform, overlayDef.frequency);
    const from = periodEnd(main[0].period);
    return pts.filter((p) => periodEnd(p.period) >= from);
  }, [overlayDef, ov.data, main]);
  const unit = transformUnit(def, transform), dec = transformDecimals(def, transform);
  const [hover, setHover] = useState<string | null>(null);

  const csv = () => {
    const rows = new Map<string, [string, string]>();
    for (const p of main) rows.set(periodEnd(p.period), [String(p.value), ""]);
    for (const p of overlay) { const k = periodEnd(p.period); const r = rows.get(k) ?? ["", ""]; r[1] = String(p.value); rows.set(k, r); }
    const head = ["date", `${def.id} ${TRANSFORM_LABEL[transform]} (${unit})`, ...(overlayDef ? [`${overlayDef.id} headline (${overlayDef.unit})`] : [])];
    const lines = [head, ...[...rows].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v[0], ...(overlayDef ? [v[1]] : [])])]
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","));
    const note = `# Source: ${def.attribution}. Plotted: ${TRANSFORM_LABEL[transform]}, range ${range}. Retrieved ${d.fetchedAt}.`;
    const blob = new Blob([`${note}\n${lines.join("\n")}\n`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${def.id}_${transform}_${range}${overlayDef ? `_vs_${overlayDef.id}` : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Section id="chart" title="b. History">
      <div className="flex items-center gap-1.5 flex-wrap">
        {RANGES.map((r) => <button key={r} className={btn(r === range)} onClick={() => onChange({ range: r })} data-testid={`macro-range-${r}`}>{r}</button>)}
        <span className="w-2" />
        {options.map((t) => <button key={t} className={btn(t === transform)} onClick={() => onChange({ transform: t })} title={TRANSFORM_LABEL[t]} data-testid={`macro-transform-${t}`}>{t === "level" ? "Level" : t === "ann3m" ? "3m ann." : t === "diff" ? "Change" : t.toUpperCase()}</button>)}
        <select value={state.overlay ?? ""} onChange={(e) => onChange({ overlay: e.target.value || null })} aria-label="Overlay a second series" data-testid="macro-overlay"
          className="ml-auto bg-term-panel border border-term-border px-1.5 py-0.5 text-[11px] text-term-text max-w-[240px]">
          <option value="">No overlay</option>
          {(def.related ?? []).filter((r) => ALL_BY_ID[r]).map((r) => <option key={r} value={r}>{seriesName(ALL_BY_ID[r], INDICATOR_NAME)}</option>)}
        </select>
        <button onClick={csv} className={cn(btn(false), "flex items-center gap-1")} title="Download exactly what is plotted (CSV)" data-testid="macro-csv"><Download size={10} /> CSV</button>
      </div>
      <div className="num text-[11px] text-term-text min-h-[16px]" data-testid="macro-hover">{hover ?? "Hover the chart for values"}</div>
      <div className="relative h-[280px] border border-term-borderSoft">
        {main.length === 0
          ? <div className="absolute inset-0 flex items-center justify-center text-term-muted text-[11px]">Not enough history for this transformation in this range.</div>
          : <Chart def={def} main={main} unit={unit} dec={dec} overlay={overlay} overlayDef={overlayDef} recessions={d.recessions} onHover={setHover} />}
      </div>
      <div className="text-[10px] text-term-muted">
        Plotted: {TRANSFORM_LABEL[transform]} ({unit}){transform !== "level" ? ", computed by this terminal from the published series" : ""}.
        {d.recessions?.length ? " Shaded: NBER recessions (FRED USREC, NBER-based)." : ""}
        {overlayDef && <> Overlay (left scale): {seriesName(overlayDef, INDICATOR_NAME)}, headline as shown in its own row{ov.isPending ? " (loading…)" : ov.isError ? ` (unavailable: ${(ov.error as Error).message})` : ""}.</>}
      </div>
    </Section>
  );
}

function Chart({ def, main, unit, dec, overlay, overlayDef, recessions, onHover }: {
  def: SeriesDef; main: Observation[]; unit: ReturnType<typeof transformUnit>; dec: number; overlay: Observation[]; overlayDef: SeriesDef | null;
  recessions: Array<[string, string]> | null; onHover: (s: string | null) => void;
}) {
  const ct = useChartTheme();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const s1 = useRef<ISeriesApi<"Line"> | null>(null);
  const s2 = useRef<ISeriesApi<"Line"> | null>(null);
  const rec = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lookup = useRef({ main: new Map<string, Observation>(), overlay: new Map<string, Observation>() });

  useEffect(() => {
    if (!box.current) return;
    const base = baseChartOptions(ct);
    const c = createChart(box.current, {
      ...base, autoSize: true, localization: { locale: "en-US" },
      timeScale: { ...base.timeScale, timeVisible: false },
      leftPriceScale: { visible: false, borderColor: ct.border },
      crosshair: { vertLine: { ...crosshairOptions(ct).vertLine, width: 1, style: LineStyle.Dashed }, horzLine: { ...crosshairOptions(ct).horzLine, width: 1, style: LineStyle.Dashed } },
    });
    rec.current = c.addHistogramSeries({ priceScaleId: "rec", color: ct.accentSoft.replace(/0\.5\)$/, "0.12)"), priceLineVisible: false, lastValueVisible: false });
    c.priceScale("rec").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    s1.current = c.addLineSeries({ color: ct.accent, lineWidth: 2, priceLineVisible: false });
    s2.current = c.addLineSeries({ color: ct.cyan, lineWidth: 1, priceScaleId: "left", priceLineVisible: false });
    c.subscribeCrosshairMove((p) => {
      const t = typeof p.time === "string" ? p.time : null;
      const a = t ? lookup.current.main.get(t) : undefined, b = t ? lookup.current.overlay.get(t) : undefined;
      if (!a && !b) { onHover(null); return; }
      onHover([a && `${periodLabel(a.period)}: ${fmtIn(a.value, unit, dec)}`, b && `overlay ${periodLabel(b.period)}: ${fmtIn(b.value, overlayDef!.unit, overlayDef!.decimals)}`].filter(Boolean).join(" · "));
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; s1.current = null; s2.current = null; rec.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  useEffect(() => {
    chart.current?.applyOptions({ ...baseChartOptions(ct), crosshair: { vertLine: crosshairOptions(ct).vertLine, horzLine: crosshairOptions(ct).horzLine } });
    s1.current?.applyOptions({ color: ct.accent });
    s2.current?.applyOptions({ color: ct.cyan });
  }, [ct]);

  useEffect(() => {
    const fmt = (u: typeof unit, d: number) => ({ type: "custom" as const, formatter: (x: number) => fmtIn(x, u, d), minMove: 10 ** -Math.min(d, 4) });
    lookup.current.main = new Map(main.map((p) => [periodEnd(p.period), p]));
    lookup.current.overlay = new Map(overlay.map((p) => [periodEnd(p.period), p]));
    s1.current?.applyOptions({ priceFormat: fmt(unit, dec) });
    s1.current?.setData(main.map((p) => ({ time: periodEnd(p.period) as Time, value: p.value })));
    if (overlayDef && overlay.length) {
      s2.current?.applyOptions({ priceFormat: fmt(overlayDef.unit, overlayDef.decimals) });
      s2.current?.setData(overlay.map((p) => ({ time: periodEnd(p.period) as Time, value: p.value })));
      chart.current?.applyOptions({ leftPriceScale: { visible: true } });
    } else {
      s2.current?.setData([]);
      chart.current?.applyOptions({ leftPriceScale: { visible: false } });
    }
    const inRec = (t: string) => !!recessions?.some(([a, b]) => t >= a && t <= b);
    rec.current?.setData(recessions?.length ? main.map((p) => { const t = periodEnd(p.period); return { time: t as Time, value: inRec(t) ? 1 : 0 }; }) : []);
    chart.current?.timeScale().fitContent();
  }, [main, overlay, overlayDef, unit, dec, recessions]);

  return <div ref={box} className="absolute inset-0" data-testid="macro-chart" />;
}

// ───────────── c. statistics ─────────────

function StatsSection({ def, headline }: { def: SeriesDef; headline: Observation[] }) {
  const rows = useMemo(() => [5, 10, null].map((y) => windowStats(headline, y)).filter((x): x is WindowStats => !!x), [headline]);
  return (
    <Section id="stats" title="c. Descriptive statistics">
      {rows.length === 0 ? <NotAvailable>At least two observations are needed.</NotAvailable> : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-[11px] num min-w-[620px]" data-testid="macro-stats-table">
            <thead><tr className="text-left text-term-muted"><th className="font-normal pr-2">Window</th><th className="font-normal pr-2">n</th><th className="font-normal pr-2 text-right">Percentile of latest</th><th className="font-normal pr-2 text-right">Mean</th><th className="font-normal pr-2 text-right">z-score</th><th className="font-normal pr-2">Min (date)</th><th className="font-normal">Max (date)</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.window} className="border-t border-term-borderSoft">
                <td className="pr-2 py-0.5">{r.window} <span className="text-term-muted">({periodLabel(r.from)} – {periodLabel(r.to)})</span></td>
                <td className="pr-2">{r.n}</td>
                <td className="pr-2 text-right">{r.percentile.toFixed(0)}th</td>
                <td className="pr-2 text-right">{fmtHeadline(def, r.mean)}</td>
                <td className="pr-2 text-right">{r.z == null ? "n/a" : r.z.toFixed(2)}</td>
                <td className="pr-2">{fmtHeadline(def, r.min.value)} ({periodLabel(r.min.period)})</td>
                <td>{fmtHeadline(def, r.max.value)} ({periodLabel(r.max.period)})</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-term-muted">Computed by this terminal on the headline series ({def.basis}), latest revised values. Windows are measured back from the latest observation. Percentile = share of observations in the window at or below the latest; z-score = (latest − mean) / standard deviation. Descriptive only; macro series are not normally distributed.</div>
    </Section>
  );
}

// ───────────── d. revisions ─────────────

function RevisionsSection({ def, d }: { def: SeriesDef; d: MacroDetail }) {
  const r = d.revisions;
  return (
    <Section id="revisions" title="d. Revisions">
      {!r.available ? <NotAvailable>{r.reason}</NotAvailable> : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <RevisionCard def={def} label="Latest period" rev={r.latest} />
            <RevisionCard def={def} label="Previous period" rev={r.previous} />
          </div>
          <div className="text-[10px] text-term-muted">Source: {r.source} ({r.vintageCount} vintages since 2008). Values are the headline ({def.basis}) recomputed from each vintage; a step is listed only when the value changed at the displayed precision.</div>
        </>
      )}
    </Section>
  );
}

function RevisionCard({ def, label, rev }: { def: SeriesDef; label: string; rev: Revisions | null }) {
  if (!rev) return <div className="border border-term-borderSoft p-2 text-[11px] text-term-muted">{label}: no vintage history available.</div>;
  return (
    <div className="border border-term-borderSoft p-2 text-[11px] num" data-testid="macro-revision-card">
      <div className="text-term-heading">{label}: {periodLabel(rev.period)}</div>
      <ul className="mt-1">
        {rev.steps.map((s, i) => <li key={s.date}>{dateLabel(s.date)}: {fmtHeadline(def, s.value)}{i === 0 ? <span className="text-term-muted"> (first print)</span> : ""}</li>)}
      </ul>
      <div className="mt-1 text-term-muted">{rev.steps.length === 1 ? "Not revised so far." : `Total revision since first print: ${fmtHeadlineDelta(def, rev.total)}.`}</div>
    </div>
  );
}

// ───────────── e. explanation + glossary ─────────────

function ExplanationSection({ expl }: { expl: Explanation | null }) {
  if (!expl) return <Section id="explanation" title="e. Explanation"><NotAvailable>No explanation has been written for this series yet.</NotAvailable></Section>;
  const jump = (g: GlossaryId) => document.getElementById(`macro-gl-${g}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  return (
    <Section id="explanation" title="e. Explanation">
      <dl className="grid gap-1.5 text-[11px] leading-relaxed">
        <Item k="What it measures">{expl.measures}</Item>
        <Item k="How it is built">{expl.construction}</Item>
        <Item k="Agency and release schedule">{expl.schedule}</Item>
        <Item k="Why markets follow it">{expl.whyMarkets}</Item>
        <Item k="How it has typically been read">
          <ul className="list-none grid gap-0.5">
            <li><b className="text-term-text">Currency:</b> {expl.interpretation.currency}</li>
            <li><b className="text-term-text">Rates:</b> {expl.interpretation.rates}</li>
            <li><b className="text-term-text">Equities:</b> {expl.interpretation.equities}</li>
            <li><b className="text-term-text">Gold:</b> {expl.interpretation.gold}</li>
          </ul>
          <div className="text-[10px] text-term-muted mt-0.5">How commentary usually frames the release, not a rule and not a prediction. Where free data allow, section h measures what actually happened on past release days.</div>
        </Item>
        <Item k="Common pitfalls"><ul className="list-disc pl-4 grid gap-0.5">{expl.pitfalls.map((p) => <li key={p}>{p}</li>)}</ul></Item>
      </dl>
      <div className="flex gap-1.5 flex-wrap items-center text-[10px]" data-testid="macro-glossary-links">
        <span className="text-term-muted">Glossary:</span>
        {expl.glossary.map((g) => <button key={g} onClick={() => jump(g)} className="underline text-term-text hover:text-term-amber">{GLOSSARY[g].term}</button>)}
      </div>
      <dl className="grid gap-1 text-[10px] text-term-muted border border-term-borderSoft p-2" data-testid="macro-glossary">
        {expl.glossary.map((g) => <div key={g} id={`macro-gl-${g}`}><dt className="inline text-term-text">{GLOSSARY[g].term}.</dt> <dd className="inline">{GLOSSARY[g].definition}</dd></div>)}
      </dl>
    </Section>
  );
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt className="text-term-heading">{k}</dt><dd className="text-term-text">{children}</dd></div>;
}

// ───────────── f. related ─────────────

function RelatedSection({ def, onOpen }: { def: SeriesDef; onOpen: (id: string) => void }) {
  const rel = (def.related ?? []).filter((r) => ALL_BY_ID[r]);
  return (
    <Section id="related" title="f. Related indicators">
      {rel.length === 0 ? <NotAvailable>No related series are linked for this indicator.</NotAvailable> : (
        <div className="flex gap-1.5 flex-wrap">
          {rel.map((r) => (
            <button key={r} onClick={() => onOpen(r)} className="px-2 py-0.5 border border-term-border text-[11px] hover:border-term-amber hover:text-term-amber" data-testid={`macro-related-${r}`}>
              {ALL_BY_ID[r].economy !== def.economy ? `${ECONOMY_NAME[ALL_BY_ID[r].economy]}: ` : ""}{seriesName(ALL_BY_ID[r], INDICATOR_NAME)}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

// ───────────── g. official documents ─────────────

function DocsSection({ def, d, expl }: { def: SeriesDef; d: MacroDetail; expl: Explanation | null }) {
  const feed = usePolicyFeed();
  const items = useMemo(() => docItems(feed.data?.items ?? [], expl?.feed, 6), [feed.data, expl]);
  return (
    <Section id="docs" title="g. Official documents and reports">
      {expl ? (
        <ul className="grid gap-0.5 text-[11px]">
          {expl.docs.map((doc) => <li key={doc.url}><a href={doc.url} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber">{doc.title}</a> <span className="text-term-muted">({doc.kind})</span></li>)}
          {d.release?.link && <li><a href={d.release.link} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber">{d.release.name}: agency release page</a> <span className="text-term-muted">(as listed in FRED's release metadata)</span></li>}
          <li><a href={expl.calendar.url} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber">{expl.calendar.label}</a> <span className="text-term-muted">(calendar)</span></li>
        </ul>
      ) : <NotAvailable>No official links are listed for this series.</NotAvailable>}
      <div className="text-[11px] text-term-heading mt-1">Latest related items from the Policy Feed</div>
      {!expl?.feed ? <div className="text-[11px] text-term-muted">No official feed covers this indicator's publications (for example, BLS refuses automated feed readers with HTTP 403, and the Beige Book has no feed); use the links above.</div>
        : feed.isPending ? <div className="text-[11px] text-term-muted">Loading official feeds…</div>
        : feed.isError ? <div className="text-[11px] text-term-red">Policy Feed unavailable: {(feed.error as Error).message}</div>
        : items.length === 0 ? <div className="text-[11px] text-term-muted">No matching item in the feeds' current window ({expl.feed.institutions.join(", ")}).</div>
        : (
          <ul className="grid gap-1.5 text-[11px]" data-testid="macro-doc-items">
            {items.map((it) => (
              <li key={it.id}>
                <a href={it.link} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber text-term-heading">{it.title}</a>
                <span className="text-term-muted"> · {it.institution} · {it.publishedAt ? dateLabel(it.publishedAt) : "date not given by the feed"}</span>
                {it.excerpt && <div className="text-term-text">{it.excerpt} <span className="text-term-muted">(feed excerpt)</span></div>}
              </li>
            ))}
          </ul>
        )}
      <div className="text-[10px] text-term-muted">Titles, dates and links as published by each institution; excerpts appear only where the feed itself provides one. Documents are never reproduced here.</div>
    </Section>
  );
}

// ───────────── h. measured market reaction ─────────────

function ReactionSection({ d }: { d: MacroDetail }) {
  const r = d.reaction;
  return (
    <Section id="reaction" title="h. Measured market reaction">
      {!r.available ? <NotAvailable>{r.reason}</NotAvailable> : <ReactionTable r={r} />}
    </Section>
  );
}

function ci(a: [number, number] | null, unit: "bp" | "%") {
  return a ? `[${fmtDelta(a[0], unit === "bp" ? "bp" : "%", 2).replace(" pp", "%")}, ${fmtDelta(a[1], unit === "bp" ? "bp" : "%", 2).replace(" pp", "%")}]` : "n/a";
}
function mean(v: number | null, unit: "bp" | "%") { return v == null ? "n/a" : unit === "bp" ? fmtDelta(v, "bp", 2) : `${fmtDelta(v, "%", 2).replace(" pp", "")}%`; }

function ReactionTable({ r }: { r: ReactionResult }) {
  return (
    <>
      <div className="text-[11px] text-term-text"><b>Basis.</b> {r.basis}</div>
      <div className="text-[11px] text-term-text"><b>Window.</b> {r.window} Releases {dateLabel(r.from)} – {dateLabel(r.to)}: {r.releases} with a direction, {r.unchanged} unchanged (excluded).</div>
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-[11px] num min-w-[640px]" data-testid="macro-reaction-table">
          <thead><tr className="text-left text-term-muted">
            <th className="font-normal pr-2">Asset (unit)</th><th className="font-normal pr-2">After a rise: n, mean [95% CI]</th><th className="font-normal pr-2">After a fall: n, mean [95% CI]</th><th className="font-normal pr-2">Difference [95% CI]</th><th className="font-normal">Result</th>
          </tr></thead>
          <tbody>{r.assets.map((a: AssetReaction) => (
            <tr key={a.asset} className="border-t border-term-borderSoft align-top">
              <td className="pr-2 py-0.5">{a.asset} ({a.unit === "bp" ? "bp" : "%"}){a.proxyNote && <div className="text-[10px] text-term-muted">{a.proxyNote}</div>}</td>
              <td className="pr-2">{a.up.n}, {mean(a.up.mean, a.unit)} {ci(a.up.ci, a.unit)}</td>
              <td className="pr-2">{a.down.n}, {mean(a.down.mean, a.unit)} {ci(a.down.ci, a.unit)}</td>
              <td className="pr-2">{a.diff ? `${mean(a.diff.estimate, a.unit)} ${ci(a.diff.ci, a.unit)}` : "n/a"}</td>
              <td className={cn(a.verdict === "significant" ? "text-term-heading" : "text-term-muted")} data-testid="macro-reaction-verdict">{a.verdict}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc pl-4 text-[10px] text-term-muted">{r.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="text-[10px] text-term-muted">Sources: {r.assets.map((a) => a.source).join("; ")}. "Not significant" means the 95% interval of the difference contains zero; "insufficient sample" means fewer than 8 releases in a group.</div>
    </>
  );
}

