import { useCallback, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMacroSnapshot } from "@/lib/macro/client";
import { ECONOMIES, ECONOMY_EXTRA_GAPS, ECONOMY_NAME, INDICATORS, INDICATOR_NAME, SERIES, STALE_RULE_TEXT } from "@/lib/macro/config";
import {
  MIN_ECONOMIES_FOR_COMPARISON, REAL_RATE_LABEL, buildViews, dateLabel, fmtChange, fmtValue, periodLabel, type MacroViews,
} from "@/lib/macro/math";
import { US_GAPS, US_SERIES } from "@/lib/macro/usCatalog";
import { readMacroUrl, usSectionLoads, writeMacroUrl } from "@/lib/macro/urlState";
import type { Economy, Indicator, RealRate, SeriesView } from "@/lib/macro/types";
import { DataNote, EmptyBlock } from "./research/shared";
import { DetailPanel, type DetailState } from "./macro/DetailPanel";
import { FedDocs } from "./macro/FedDocs";
import { Spark, UsDeep } from "./macro/UsDeep";

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text focus:outline-none focus:border-term-amber";

export function MACRO() {
  const q = useMacroSnapshot();
  const snap = q.data;
  // Ages are measured against the browser clock at the moment the data was last received, so a tab left open
  // keeps flagging staleness on refetch and never freezes at "fresh".
  const views = useMemo(() => buildViews(snap, Date.now()), [snap, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [econ, setEcon] = useState<Economy | "all">("all");
  const [ind, setInd] = useState<Indicator | "all">("all");
  // The US catalogue and the release calendar cost FRED requests, so they load only when the US section is opened.
  const [usOpened, setUsOpened] = useState(false);
  const usOn = usSectionLoads(econ, usOpened);
  const openUs = useCallback(() => setUsOpened(true), []);
  // The open detail view lives in the URL (?macro=…), so it survives a reload and can be shared as a deep link.
  const [detail, setDetail] = useState<DetailState | null>(() => {
    const u = readMacroUrl();
    return u.id ? { id: u.id, transform: u.transform, range: u.range, overlay: u.overlay } : null;
  });
  const open = useCallback((id: string) => {
    const next = { id, transform: null, range: null, overlay: null };
    setDetail(next); writeMacroUrl(next);
  }, []);
  const change = useCallback((s: Partial<DetailState>) => {
    setDetail((d) => { const next = d ? { ...d, ...s } : null; if (next) writeMacroUrl(next); return next; });
  }, []);
  const close = useCallback(() => { setDetail(null); writeMacroUrl({ id: null }); }, []);
  const selId = detail?.id ?? null;

  const rows = views.shown.filter((v) => (econ === "all" || v.def.economy === econ) && (ind === "all" || v.def.indicator === ind));

  return (
    <div className="h-full relative">
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">MACRO HUB</span>
            <span className="text-term-muted text-[11px]">G8 macro data from official provider APIs, FRED and DBnomics · click any row for its detail view · descriptive · not live</span>
          </div>
          {snap && <StatusLine fetchedAt={snap.fetchedAt} cacheState={snap.cacheState} adapter={snap.adapter} />}
        </div>
        <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5" data-testid="macro-refresh">
          <RefreshCw size={13} className={cn(q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.isPending && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]" data-testid="macro-loading">Loading macro data…</div>}
      {q.isError && !q.isPending && <MacroError error={q.error} onRetry={() => q.refetch()} fetching={q.isFetching} />}
      {snap && snap.cacheState === "STALE" && <Banner testid="macro-stale-cache">{snap.warnings[0]}</Banner>}
      {snap && <AccessProblems views={views} />}
      {snap && <SourceNotes views={views} />}

      {snap && (
        <>
          <Overview views={views} rows={rows} econ={econ} setEcon={setEcon} ind={ind} setInd={setInd} selId={selId} onSelect={open} />
          <RealRatePanel views={views} onOpen={open} />
          {(econ === "all" || econ === "US") && <UsDeep onOpen={open} selId={selId} enabled={usOn} onLoad={openUs} />}
          {(econ === "all" || econ === "US") && <FedDocs onOpen={open} calendarEnabled={usOn} onLoadCalendar={openUs} />}
          <CoverageGaps views={views} />
        </>
      )}

      <Sources />
      <About />
    </div>
    {detail && <DetailPanel state={detail} onChange={change} onClose={close} />}
    </div>
  );
}

// ───────────── status + states ─────────────

function StatusLine({ fetchedAt, cacheState, adapter }: { fetchedAt: string; cacheState: string; adapter: string }) {
  const t = new Date(fetchedAt);
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]" data-testid="macro-status">
      <span className="num text-term-text">Retrieved {t.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-borderSoft text-term-muted" title={`Adapters: ${adapter.split("+").join(", ")}`}>{adapter.split("+").length} source adapters · server cache {cacheState}</span>
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

const PROBLEM_TITLE: Record<string, string> = { key_missing: "API key missing", key_rejected: "API key rejected", blocked: "Source blocked" };

/** Series that cannot load because a key is missing/rejected or a bot challenge blocks the provider: said loudly, never a silent empty cell. */
function AccessProblems({ views }: { views: MacroViews }) {
  if (views.accessProblems.length === 0) return null;
  return (
    <>
      {views.accessProblems.map((p) => (
        <Banner key={`${p.kind}|${p.message}`} testid={`macro-${p.kind.replace("_", "-")}`}>
          <b>{PROBLEM_TITLE[p.kind]}</b> — {p.labels.join("; ")}: {p.message}
        </Banner>
      ))}
    </>
  );
}

/** Small, non-blocking note: the series are shown normally, but through a fallback route (e.g. keyless BLS v1 because the key is missing or rejected). */
function SourceNotes({ views }: { views: MacroViews }) {
  if (views.notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 text-[10px] text-term-muted" data-testid="macro-source-notes">
      {views.notices.map((n) => (
        <div key={`${n.kind}|${n.message}`} data-testid={`macro-note-${n.kind.replace("_", "-")}`}>
          <b className="text-term-text">{PROBLEM_TITLE[n.kind]}</b> · {n.labels.join("; ")}: {n.message}
        </div>
      ))}
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
                <th className="px-2 py-1.5 font-normal">Source updated</th>
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
                          <Chip testid="macro-stale-chip" title={`Older than expected: ${v.freshness.ageDays} days since ${v.freshness.basis === "refresh" ? "the source last refreshed it" : "the end of the period"}; expected at most ${v.freshness.lagDays}.`}>STALE</Chip>
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
      <div className="text-[10px] text-term-muted">Click any row for its detail view (history, statistics, revisions, explanation, related series, official documents and, where free data allow, measured market reactions). Changes are plain differences versus the previous observation; no value is colour-coded. Stale rule: see below the table.</div>
      <div className="text-[10px] text-term-muted" data-testid="macro-stale-rule"><b className="text-term-text">STALE rule.</b> {STALE_RULE_TEXT}</div>
    </div>
  );
}

// ───────────── real policy rate ─────────────

type SortKey = "economy" | "real" | "policy" | "cpi";

function RealRatePanel({ views, onOpen }: { views: MacroViews; onOpen: (id: string) => void }) {
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
        <Comparison rows={ok} onOpen={onOpen} />
      ) : (
        <RealRateTable rows={ok} onOpen={onOpen} />
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

const inputId = (e: Economy, i: Indicator) => SERIES.find((d) => d.economy === e && d.indicator === i)?.id;
function InputLink({ e, i, children, onOpen }: { e: Economy; i: Indicator; children: React.ReactNode; onOpen: (id: string) => void }) {
  const id = inputId(e, i);
  return id ? <button onClick={() => onOpen(id)} className="underline decoration-dotted underline-offset-2 hover:text-term-amber" title="Open the detail view">{children}</button> : <>{children}</>;
}

function RealRateTable({ rows, onOpen }: { rows: RealRate[]; onOpen: (id: string) => void }) {
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[640px] text-[12px]" data-testid="macro-realrate-table">
        <thead><tr className="text-left sub-header border-b border-term-borderSoft">
          <th className="px-2 py-1.5 font-normal">Economy</th><th className="px-2 py-1.5 font-normal text-right">Real policy rate</th>
          <th className="px-2 py-1.5 font-normal">Policy rate (observation)</th><th className="px-2 py-1.5 font-normal">CPI YoY (observation)</th>
        </tr></thead>
        <tbody>{rows.map((r) => <RealRow key={r.economy} r={r} onOpen={onOpen} />)}</tbody>
      </table>
    </div>
  );
}

function RealRow({ r, onOpen }: { r: RealRate; onOpen: (id: string) => void }) {
  return (
    <tr className="border-b border-term-borderSoft">
      <td className="px-2 py-1.5 text-term-heading">{ECONOMY_NAME[r.economy]}</td>
      <td className="px-2 py-1.5 text-right num text-term-heading">{fmtValue(r.value, 2)}% <Chip>computed</Chip></td>
      <td className="px-2 py-1.5 num"><InputLink e={r.economy} i="policy_rate" onOpen={onOpen}>{fmtValue(r.policy!.value, 2)}%</InputLink> <span className="text-term-muted">· {periodLabel(r.policy!.period)} · {r.policy!.frequency}</span></td>
      <td className="px-2 py-1.5 num"><InputLink e={r.economy} i="cpi_yoy" onOpen={onOpen}>{fmtValue(r.cpi!.value, 1)}%</InputLink> <span className="text-term-muted">· {periodLabel(r.cpi!.period)} · {r.cpi!.frequency}</span></td>
    </tr>
  );
}

/** Only mounted when at least MIN_ECONOMIES_FOR_COMPARISON economies qualify. Neutral styling: sorting never implies good or bad. */
function Comparison({ rows, onOpen }: { rows: RealRate[]; onOpen: (id: string) => void }) {
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
            <td className="px-2 py-1.5 text-right num"><InputLink e={r.economy} i="policy_rate" onOpen={onOpen}>{fmtValue(r.policy!.value, 2)}%</InputLink></td>
            <td className="px-2 py-1.5 text-right num"><InputLink e={r.economy} i="cpi_yoy" onOpen={onOpen}>{fmtValue(r.cpi!.value, 1)}%</InputLink></td>
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
  no_series: "No fresh series found", excluded_provider: "Provider excluded", stale_mirror: "Stale mirror", not_pinned: "Not wired yet", fetch_error: "Fetch problem", too_old: "Too old to show",
  key_missing: "API key missing", key_rejected: "API key rejected", blocked: "Source blocked",
};

function CoverageGaps({ views }: { views: MacroViews }) {
  const byEcon = ECONOMIES.map((e) => ({ e, gaps: views.gaps.filter((g) => g.economy === e.id) })).filter((x) => x.gaps.length > 0);
  return (
    <details open className="border border-term-borderSoft" data-testid="macro-gaps">
      <summary className="px-3 py-2 cursor-pointer sub-header select-none">Coverage gaps — {views.gaps.length} of 48 overview cells have no series shown; series beyond the overview listed below</summary>
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
        <div data-testid="macro-gaps-beyond">
          <div className="text-term-heading text-[11px] mb-1">Beyond the overview: series not shown, and why</div>
          <div className="text-[11px] text-term-muted mb-1">United States: {US_SERIES.length + SERIES.filter((d) => d.economy === "US").length} series are covered (see the US section); these were requested or are commonly followed but are not shown.</div>
          <GapList title="United States" rows={US_GAPS} />
          {(Object.keys(ECONOMY_EXTRA_GAPS) as Array<keyof typeof ECONOMY_EXTRA_GAPS>).map((e) => <GapList key={e} title={ECONOMY_NAME[e]} rows={ECONOMY_EXTRA_GAPS[e]} />)}
        </div>
      </div>
    </details>
  );
}

function GapList({ title, rows }: { title: string; rows: { name: string; reason: string }[] }) {
  return (
    <div className="mb-2">
      <div className="text-term-text text-[11px]">{title} <span className="text-term-muted">({rows.length})</span></div>
      <table className="w-full text-[11px]"><tbody>
        {rows.map((g) => (
          <tr key={g.name} className="border-t border-term-borderSoft align-top">
            <td className="py-1 pr-3 w-[300px]">{g.name}</td>
            <td className="py-1 text-term-muted">{g.reason}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
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
      <div className="mb-1">Each series is fetched either directly from its provider's own API (the provider is named on the row) or through DBnomics (db.nomics.world), a free open aggregator that redistributes each provider's data as-is, so a DBnomics series is only as fresh as its last mirror. Licences are not audited for this non-commercial terminal; attribution is kept and a licence note is shown only where a provider states one plainly.</div>
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
        <b>What this is.</b> A reference page of published macroeconomic statistics for a few large economies, pulled from the statistics offices and central banks themselves where a free API exists, and from DBnomics otherwise. It is <b>descriptive context, not a prediction</b>:
        nothing here forecasts, scores or signals anything, and values are never coloured as good or bad.
      </p>
      <p className="mb-1.5">
        <b>Why the dates lag.</b> Statistics describe a past period and are published afterwards: inflation roughly two to three weeks after the month ends, unemployment from about four weeks (Australia) to two and a half months (UK),
        GDP one to three months after the quarter ends, and they are often revised later. Central-bank rates and bond yields are daily, but some sources publish them with their own delay (DBnomics mirrors, weekly cubes).
        So a figure marked "Aug 2026" is an August number, not today's; always read the observation period beside the value.
      </p>
      <p className="mb-1.5">
        <b>Indicators.</b> <b>Policy rate</b>: the central bank's main interest rate (the US row shows the upper limit of the FOMC's federal funds target range; Australia's cash rate target changes only at meetings, so its date is the date the rate took effect).
        <b> CPI inflation (YoY)</b>: change in consumer prices versus the same period a year earlier; where a provider publishes only the index or level (Japan, Canada, the United States, Swiss GDP), the year-on-year change is computed here and labelled "computed". Where the index is rounded to one decimal, a computed figure can differ from the statistics office's own year-on-year by about 0.1 percentage point.
        <b> Core CPI</b>: the same excluding the most volatile items (definitions differ by country: Japan excludes fresh food and energy, Australia uses the trimmed mean).
        <b> Unemployment rate</b>: share of the labour force without work and seeking it. <b>Real GDP growth</b>: change in inflation-adjusted output; the basis differs by country (US quarter-on-quarter annualised, UK quarter-on-quarter, Euro Area and Australia year-on-year) and the basis is shown on each row, so rows are not directly comparable.
        <b> 10Y yield</b>: the yield on 10-year government bonds.
      </p>
      <p className="mb-1.5">
        <b>Real policy rate</b> (computed: policy rate minus CPI YoY, latest available of each) mixes a daily or step rate with a monthly or quarterly CPI. It is shown only when both inputs are fresh, with both observation dates; it describes the gap between two published numbers, not a measure of how tight policy is.
      </p>
      <p>
        <b>Coverage.</b> Where no free, fresh endpoint was found (or an endpoint blocks automated access, or an API key is missing), the cell is listed under Coverage gaps with the reason instead of being shown empty or estimated. Rows marked "via FRED" or "via BIS" come from a republisher and say so in the provider column. PMI and other proprietary series are not included.
      </p>
    </DataNote>
  );
}
