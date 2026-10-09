import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useGauges } from "@/lib/gauges/data";
import { CHANGE_DEFINITION, GAUGES_NOTE, INTRADAY_LABEL, LOOKBACKS, PAIRS, PERCENTILE_DEFINITION, STRENGTH_FORMULA, type Lookback } from "@/lib/gauges/config";
import { fmtNum, fmtSigned, maybeIntraday } from "@/lib/gauges/math";
import type { StrengthResult, VolReading } from "@/lib/gauges/types";
import { periodLabel } from "@/lib/macro/math";
import { DataNote, EmptyBlock, SectionTitle } from "./research/shared";

const LB_LABEL: Record<Lookback, string> = { 1: "1 day", 5: "5 days", 20: "20 days" };

export function GAUGES() {
  const q = useGauges();
  const b = q.data;
  const [lb, setLb] = useState<Lookback>(5);

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">VOL &amp; CURRENCY STRENGTH</span>
            <span className="text-term-muted text-[11px]">daily closes · descriptive · not a forecast</span>
          </div>
          {b && <div className="text-[11px] num text-term-text" data-testid="gauges-status">Loaded {new Date(b.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} in {(b.loadMs / 1000).toFixed(1)} s · two requests · cached 15 min</div>}
        </div>
        <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5" data-testid="gauges-refresh">
          <RefreshCw size={13} className={cn(q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.isPending && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]" data-testid="gauges-loading">Loading daily history…</div>}
      {q.isError && !q.isPending && (
        <div className="p-3 text-term-red flex flex-col items-start gap-2 text-[12px]" role="alert" data-testid="gauges-error">
          <div><span className="sub-header text-term-red mr-1">ERROR</span>{(q.error as Error).message}</div>
          <button onClick={() => q.refetch()} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
            <RefreshCw size={11} className={cn(q.isFetching && "animate-spin")} /> Retry
          </button>
        </div>
      )}

      {b && (
        <>
          <section data-testid="gauges-vol" className="flex flex-col gap-2">
            <SectionTitle>VOLATILITY BOARD</SectionTitle>
            {b.vol.length === 0 ? <EmptyBlock>No volatility index could be loaded.</EmptyBlock> : <VolTable rows={b.vol} />}
            {b.volFailures.length > 0 && (
              <ul className="text-[11px] text-term-muted" data-testid="gauges-vol-failures">
                {b.volFailures.map((f) => <li key={f.id}><span className="text-term-text">{f.label}</span>: unavailable — {f.error}</li>)}
              </ul>
            )}
            <div className="text-[10px] text-term-muted leading-relaxed"><b className="text-term-text">Definitions.</b> {PERCENTILE_DEFINITION} {CHANGE_DEFINITION}</div>
          </section>

          <section data-testid="gauges-strength" className="flex flex-col gap-2">
            <SectionTitle>CURRENCY STRENGTH</SectionTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="sub-header">Lookback</span>
              {LOOKBACKS.map((n) => (
                <button key={n} onClick={() => setLb(n)} data-testid={`gauges-lb-${n}`}
                  className={cn("px-2 py-0.5 border text-[10px] uppercase tracking-wider", lb === n ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-amber")}>{LB_LABEL[n]}</button>
              ))}
              <span className="text-[11px] text-term-muted num">{b.strength.asOf ? `as of ${periodLabel(b.strength.asOf)} · ${b.strength.pairsUsed.length} of ${PAIRS.length} pairs · ${b.strength.commonDates} common trading days` : ""}</span>
            </div>
            {b.strength.pairsUsed.length === 0 ? <EmptyBlock>{b.fxError ?? "No currency pair could be loaded."}</EmptyBlock> : <StrengthTable r={b.strength.results.find((x) => x.lookback === lb)!} />}
            {b.strength.pairsLeftOut.length > 0 && (
              <ul className="text-[11px] text-term-muted" data-testid="gauges-pairs-left-out">
                {b.strength.pairsLeftOut.map((p) => <li key={p.id}><span className="text-term-text">{p.id}</span> left out — {p.why}. Currencies that depend on it show n/a.</li>)}
              </ul>
            )}
            <div className="text-[10px] text-term-muted leading-relaxed" data-testid="gauges-formula"><b className="text-term-text">Formula.</b> {STRENGTH_FORMULA} <b className="text-term-text">Pairs:</b> {PAIRS.map((p) => p.id).join(", ")} (daily closes). <b className="text-term-text">Lookbacks:</b> 1, 5 and 20 trading days between common trading dates of the pairs used.</div>
          </section>
        </>
      )}

      <DataNote>
        <p className="mb-1.5"><b>What this is.</b> {GAUGES_NOTE}</p>
        <p className="mb-1.5"><b>Volatility board.</b> A volatility index is the market's implied expectation of how much an asset will move over the next 30 days, quoted in annualised percent. A higher level means options are priced for larger moves. The percentile only places today's level within the last 1 and 5 years of the same index; it does not say whether volatility will rise or fall. If a window is not fully covered by the data, that percentile is not shown.</p>
        <p><b>Currency strength.</b> The ranking compares each currency's recent move against the other seven. Because it is built from the seven USD pairs by an exact identity, a currency that did not move against the dollar still ranks above one that fell and below one that rose. A pair that cannot be loaded, or whose latest close is stale, is left out and named; currencies that need it show n/a rather than a guess.</p>
      </DataNote>
    </div>
  );
}

function VolTable({ rows }: { rows: VolReading[] }) {
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[820px] text-[12px]" data-testid="gauges-vol-table">
        <thead><tr className="text-left sub-header border-b border-term-borderSoft">
          <th className="px-2 py-1.5 font-normal">Index</th><th className="px-2 py-1.5 font-normal text-right">Level</th><th className="px-2 py-1.5 font-normal">As of</th>
          <th className="px-2 py-1.5 font-normal text-right">1-day change</th><th className="px-2 py-1.5 font-normal text-right">5-day change</th>
          <th className="px-2 py-1.5 font-normal text-right">1-year percentile</th><th className="px-2 py-1.5 font-normal text-right">5-year percentile</th>
        </tr></thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-term-borderSoft align-top" data-testid={`gauges-vol-${v.id}`}>
              <td className="px-2 py-1.5"><div className="text-term-heading">{v.label}</div><div className="text-[10px] text-term-muted max-w-[260px] leading-snug">{v.measures}</div></td>
              <td className="px-2 py-1.5 text-right num text-term-heading">{fmtNum(v.level)}</td>
              <td className="px-2 py-1.5 num whitespace-nowrap">{periodLabel(v.asOf)}{maybeIntraday(v.asOf, Date.now()) && <div><span data-testid="gauges-intraday" title="The newest daily bar is dated today, so the session is still in progress and this is not a final close. Changes and percentiles use it as it stands." className="text-[10px] tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber">{INTRADAY_LABEL}</span></div>}</td>
              <td className="px-2 py-1.5 text-right num">{v.change1d ? <>{fmtSigned(v.change1d.points)}<div className="text-[10px] text-term-muted">{fmtSigned(v.change1d.pct, 1)}%</div></> : "n/a"}</td>
              <td className="px-2 py-1.5 text-right num">{v.change5d ? <>{fmtSigned(v.change5d.points)}<div className="text-[10px] text-term-muted">{fmtSigned(v.change5d.pct, 1)}%</div></> : "n/a"}</td>
              <td className="px-2 py-1.5 text-right num" data-testid="gauges-p1">{v.pctile1y == null ? "n/a" : fmtNum(v.pctile1y, 1)}<div className="text-[10px] text-term-muted">{v.n1y} closes</div></td>
              <td className="px-2 py-1.5 text-right num" data-testid="gauges-p5">{v.pctile5y == null ? "n/a" : fmtNum(v.pctile5y, 1)}<div className="text-[10px] text-term-muted">{v.n5y} closes</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((v) => v.warnings.length > 0) && <div className="px-2 py-1 text-[10px] text-term-muted" data-testid="gauges-vol-warnings">{rows.flatMap((v) => v.warnings.map((w) => `${v.label}: ${w}`)).join(" · ")}</div>}
    </div>
  );
}

function StrengthTable({ r }: { r: StrengthResult }) {
  const known = r.rows.filter((x) => x.rank != null).sort((a, c) => (a.rank as number) - (c.rank as number));
  const unknown = r.rows.filter((x) => x.rank == null);
  const max = Math.max(0.0001, ...known.map((x) => Math.abs(x.value as number)));
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[520px] text-[12px]" data-testid="gauges-strength-table">
        <thead><tr className="text-left sub-header border-b border-term-borderSoft">
          <th className="px-2 py-1.5 font-normal">Rank</th><th className="px-2 py-1.5 font-normal">Currency</th><th className="px-2 py-1.5 font-normal text-right">Strength ({LB_LABEL[r.lookback]})</th><th className="px-2 py-1.5 font-normal w-[40%]">Relative to the other seven</th>
        </tr></thead>
        <tbody>
          {known.map((x) => {
            const w = (Math.abs(x.value as number) / max) * 50;
            return (
              <tr key={x.currency} className="border-b border-term-borderSoft" data-testid={`gauges-ccy-${x.currency}`}>
                <td className="px-2 py-1.5 num text-term-muted">{x.rank}</td>
                <td className="px-2 py-1.5 text-term-heading">{x.currency}</td>
                <td className="px-2 py-1.5 text-right num">{fmtSigned(x.value, 2)}%</td>
                <td className="px-2 py-1.5"><div className="relative h-2 bg-term-panel2"><div className="absolute top-0 bottom-0 left-1/2 w-px bg-term-border" /><div className="absolute top-0 bottom-0 bg-term-amber/70" style={(x.value as number) >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} /></div></td>
              </tr>
            );
          })}
          {unknown.map((x) => (
            <tr key={x.currency} className="border-b border-term-borderSoft text-term-muted" data-testid={`gauges-ccy-${x.currency}`}>
              <td className="px-2 py-1.5">—</td><td className="px-2 py-1.5">{x.currency}</td><td className="px-2 py-1.5 text-right num">n/a</td><td className="px-2 py-1.5">not enough data for this window</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1 text-[10px] text-term-muted num">{r.from && r.to ? `Window: close of ${periodLabel(r.from)} to close of ${periodLabel(r.to)}. Bars show size and direction only; a longer bar to the right is not "good" and to the left is not "bad".` : "Window not available."}</div>
    </div>
  );
}
