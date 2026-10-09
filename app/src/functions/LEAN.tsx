import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLeanBundle, useGoldHeadline, leanFromBundle } from "@/lib/lean/data";
import { BASE_WEIGHTS, DRIVER_AGREEMENT_NOTE, INSTRUMENTS, LEAN_THRESHOLD, SERIES, WALK_FORWARD_MULT } from "@/lib/lean/config";
import { historicalAgreement } from "@/lib/lean/history";
import backtest from "@/lib/lean/backtest.json";
import type { DriverResult, LeanResult } from "@/lib/lean/types";
import { CotStatus } from "@/components/CotStatus";
import { DataNote, EmptyBlock } from "./research/shared";

const DISCLAIMER = "Context only, not financial advice.";
const fmt2 = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const tone = (d: string) => (d === "bullish" ? "text-term-green" : d === "bearish" ? "text-term-red" : "text-term-muted");
const labelTone = (l: string) => (l === "Bullish lean" ? "text-term-green border-term-green/50" : l === "Bearish lean" ? "text-term-red border-term-red/50" : "text-term-muted border-term-borderSoft");

export function LEAN() {
  const q = useLeanBundle();
  const gold = useGoldHeadline();
  const [sel, setSel] = useState("XAUUSD");
  const results = q.data ? leanFromBundle(q.data) : null;
  const cur = results?.find((r) => r.instrumentId === sel) ?? null;

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">MARKET LEAN</span>
            <span className="text-term-muted text-[11px]">transparent directional context · daily data · not a signal</span>
          </div>
          <div className="text-term-muted text-[11px]" data-testid="lean-disclaimer">{DISCLAIMER}</div>
        </div>
        <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5">
          <RefreshCw size={13} className={cn(q.isFetching && "animate-spin")} />
        </button>
      </div>

      <GoldHeadline q={gold} />

      {q.isPending && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]" data-testid="lean-loading">Loading daily history for 13 instruments… (first load can take 15–30 s)</div>}
      {q.isError && (
        <div className="p-3 text-term-red flex flex-col items-start gap-2" role="alert" data-testid="lean-error">
          <div><span className="sub-header text-term-red mr-1">ERROR</span>{(q.error as Error).message}</div>
          <button onClick={() => q.refetch()} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
            <RefreshCw size={11} className={cn(q.isFetching && "animate-spin")} /> Retry
          </button>
        </div>
      )}
      {q.data && results && results.every((r) => r.label === "Insufficient data") && (
        <EmptyBlock>No instrument has enough daily history to score right now.</EmptyBlock>
      )}

      {q.data && results && (
        <>
          <Overview results={results} sel={sel} onSelect={setSel} />
          {Object.keys(q.data.seriesErrors).length > 0 && (
            <div className="border border-term-amber/60 bg-term-amberSubtle px-2 py-1 text-[11px] leading-snug" data-testid="lean-partial">
              Some inputs failed to load and are shown as n/a (driver agreement is lowered, nothing is dropped silently):{" "}
              {Object.entries(q.data.seriesErrors).map(([id, e]) => `${SERIES[id]?.label ?? id}: ${e}`).join(" · ")}
            </div>
          )}
          {cur && <Detail r={cur} cotSnap={q.data.cot} loadMs={q.data.loadMs} fetchedAt={q.data.fetchedAt} />}
        </>
      )}
      <Methodology />
    </div>
  );
}

function GoldHeadline({ q }: { q: ReturnType<typeof useGoldHeadline> }) {
  return (
    <div className="border border-term-borderSoft px-2 py-1.5 flex items-center gap-3 flex-wrap text-[11px]" data-testid="lean-gold-headline">
      <span className="sub-header">LIVE GOLD HEADLINE · XAU/USD SPOT</span>
      {q.isPending ? <span className="text-term-muted">loading…</span>
        : q.isError ? (
          <span className="text-term-red flex items-center gap-2">unavailable — {(q.error as Error).message}
            <button onClick={() => q.refetch()} className="underline">Retry</button></span>
        ) : (
          <>
            <span className="num text-term-heading text-[14px]">{q.data.last?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "n/a"}</span>
            <span className="text-term-muted">Twelve Data · as of {q.data.asOf ? new Date(q.data.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "n/a"} · headline only, the lean itself uses daily bars</span>
          </>
        )}
    </div>
  );
}

function Overview({ results, sel, onSelect }: { results: LeanResult[]; sel: string; onSelect: (id: string) => void }) {
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[720px]" data-testid="lean-table">
        <thead>
          <tr className="text-left sub-header border-b border-term-borderSoft">
            <th className="px-2 py-1.5 font-normal">Instrument</th>
            <th className="px-2 py-1.5 font-normal">Lean</th>
            <th className="px-2 py-1.5 font-normal text-right">Composite</th>
            <th className="px-2 py-1.5 font-normal text-right" title={DRIVER_AGREEMENT_NOTE}>Driver agreement</th>
            <th className="px-2 py-1.5 font-normal text-right">Confirmers agree</th>
            <th className="px-2 py-1.5 font-normal text-right">Last bar</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const inst = INSTRUMENTS.find((i) => i.id === r.instrumentId)!;
            return (
              <tr key={r.instrumentId} onClick={() => onSelect(r.instrumentId)} data-testid={`lean-row-${r.instrumentId}`}
                className={cn("border-b border-term-borderSoft cursor-pointer hover:bg-term-amberSubtle", sel === r.instrumentId && "bg-term-amberSubtle")}>
                <td className="px-2 py-1.5"><span className="text-term-heading">{inst.label}</span></td>
                <td className="px-2 py-1.5"><span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 border", labelTone(r.label))}>{r.label}</span></td>
                <td className="px-2 py-1.5 text-right num">{r.composite == null ? "n/a" : fmt2(r.composite)}</td>
                <td className="px-2 py-1.5 text-right num">{r.label === "Insufficient data" ? "n/a" : r.driverAgreement}</td>
                <td className="px-2 py-1.5 text-right num">{r.confirmers.total ? `${r.confirmers.agree}/${r.confirmers.total}` : "n/a"}</td>
                <td className="px-2 py-1.5 text-right num text-term-muted">{r.freshness.ownLastBar ?? "n/a"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ r, cotSnap, loadMs, fetchedAt }: { r: LeanResult; cotSnap: import("@/lib/cot").CotSnapshot | null; loadMs: number; fetchedAt: string }) {
  const inst = INSTRUMENTS.find((i) => i.id === r.instrumentId)!;
  const ha = historicalAgreement(r.instrumentId);
  return (
    <div className="flex flex-col gap-3" data-testid="lean-detail">
      <div className="border border-term-borderSoft p-3 flex flex-col gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-term-heading text-[15px] font-bold">{inst.label}</span>
          <span className={cn("text-[11px] uppercase tracking-wider px-2 py-0.5 border", labelTone(r.label))} data-testid="lean-label">{r.label}</span>
          {r.label !== "Insufficient data" && <span className="num text-term-text" data-testid="lean-driver-agreement" title={DRIVER_AGREEMENT_NOTE}>Driver agreement {r.driverAgreement}/100</span>}
        </div>
        {r.label !== "Insufficient data" && <div className="text-[11px] text-term-muted" data-testid="lean-agreement-note">{DRIVER_AGREEMENT_NOTE}</div>}
        {r.composite != null && (
          <div className="text-[11px] text-term-muted num" data-testid="lean-formula">
            Driver agreement = sign agreement × data completeness × 100 = {r.signAgreement.toFixed(2)} × {r.completeness.toFixed(2)} × 100 = {r.driverAgreement}. Composite {fmt2(r.composite)} (Bullish ≥ +{LEAN_THRESHOLD.toFixed(2)}, Bearish ≤ −{LEAN_THRESHOLD.toFixed(2)}).
          </div>
        )}
        <div className="text-[11px] text-term-text" data-testid="lean-history">
          <span className="sub-header mr-2">HISTORICAL AGREEMENT</span>{ha.text}{" "}
          <span className="text-term-muted">{ha.caveat}</span>
        </div>
      </div>

      {r.warnings.length > 0 && (
        <div className="border border-term-amber/60 bg-term-amberSubtle px-2 py-1 text-[11px] leading-snug" data-testid="lean-warnings">
          {r.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
        <table className="w-full min-w-[760px]" data-testid="lean-drivers">
          <thead>
            <tr className="text-left sub-header border-b border-term-borderSoft">
              <th className="px-2 py-1.5 font-normal">Driver / input</th>
              <th className="px-2 py-1.5 font-normal">Raw value</th>
              <th className="px-2 py-1.5 font-normal">Direction</th>
              <th className="px-2 py-1.5 font-normal text-right">Score</th>
              <th className="px-2 py-1.5 font-normal text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {r.drivers.map((d) => <DriverRows key={d.id} d={d} />)}
          </tbody>
        </table>
      </div>
      <div className="text-term-muted text-[11px]" data-testid="lean-cross">
        Cross-asset: {r.confirmers.agree} of {r.confirmers.total} confirmers agree with the lean direction ({r.confirmers.against} against, {r.confirmers.neutral} neutral).
      </div>

      <div className="border border-term-borderSoft p-3" data-testid="lean-flips">
        <div className="sub-header mb-1.5">WHAT WOULD CHANGE THIS LEAN</div>
        <ul className="list-disc pl-4 flex flex-col gap-1 text-term-text">
          {r.flips.map((f, i) => <li key={i}>{f.text}</li>)}
        </ul>
      </div>

      <div className="border border-term-borderSoft p-3 flex flex-col gap-1.5" data-testid="lean-freshness">
        <div className="sub-header">DATA FRESHNESS</div>
        <div className="text-[11px] text-term-text num">
          {inst.label} last daily bar: {r.freshness.ownLastBar ?? "n/a"} · other inputs use bars strictly before that date · page fetched {new Date(fetchedAt).toLocaleTimeString("en-US")} ({(loadMs / 1000).toFixed(1)} s to load) · yields: Federal Reserve H.15, one business day behind.
        </div>
        {inst.cot && (cotSnap ? <CotStatus snap={cotSnap} compact /> : <div className="text-[11px] text-term-muted">COT snapshot unavailable.</div>)}
      </div>
      <div className="text-term-muted text-[11px]">{DISCLAIMER}</div>
    </div>
  );
}

function DriverRows({ d }: { d: DriverResult }) {
  return (
    <>
      <tr className="border-b border-term-borderSoft bg-term-panel2" data-testid={`lean-driver-${d.id}`}>
        <td className="px-2 py-1.5 text-term-heading font-semibold">{d.label}{d.displayOnly && <span className="ml-2 text-[10px] uppercase tracking-wider text-term-muted border border-term-borderSoft px-1">{d.multiplier === 0 && d.baseWeight > 0 && d.weight === 0 && WALK_FORWARD_MULT[d.id] === 0 ? "weight 0 · no edge" : "display-only"}</span>}</td>
        <td className="px-2 py-1.5 text-term-muted text-[11px]">{d.note ?? (d.completeness < 1 ? `${Math.round(d.completeness * 100)}% of inputs available` : "")}</td>
        <td className={cn("px-2 py-1.5", tone(d.direction))}>{d.direction}</td>
        <td className="px-2 py-1.5 text-right num">{d.score == null ? "n/a" : fmt2(d.score)}</td>
        <td className="px-2 py-1.5 text-right num text-[11px]">{d.baseWeight.toFixed(2)} × {d.multiplier} = {d.weight.toFixed(2)}</td>
      </tr>
      {d.components.map((c) => (
        <tr key={c.id} className="border-b border-term-borderSoft/50">
          <td className="px-2 py-1 pl-5 text-term-text">{c.label}</td>
          <td className={cn("px-2 py-1 text-[11px]", c.score == null && !c.infoOnly ? "text-term-red" : "text-term-text")}>{c.score == null && c.missing && !c.infoOnly ? `n/a — ${c.missing}` : c.raw}</td>
          <td className={cn("px-2 py-1", tone(c.direction))}>{c.infoOnly ? "info" : c.direction}</td>
          <td className="px-2 py-1 text-right num">{c.score == null ? "" : fmt2(c.score)}</td>
          <td />
        </tr>
      ))}
    </>
  );
}

function Methodology() {
  const dec = (backtest as any).decisions as Record<string, { z: number | null; edge: number | null; keep: boolean }>;
  const rows: [string, string][] = [
    ["Trend", "Four legs per series: price vs 50-day SMA, price vs 200-day SMA, 50-day SMA slope over 20 days, 20-day momentum. Each leg = tanh(move / (σ·√N)), σ = stdev of the last 60 daily log returns, N = 25 / 100 / 20 / 20. Score = mean of the legs."],
    ["Positioning (COT)", "Official CFTC futures-only data via the shared COT module. Score = sign × (3Y net percentile − 50) / 50 for the mapped trader group; sign is −1 for USD/xxx pairs. S&P 500, Nasdaq 100 and Bitcoin are display-only because leveraged-fund nets there reflect basis / relative-value trades, not direction. Weekly: positions as of Tuesday, published Friday, never live."],
    ["Dollar & rates", "Trend score (as above) of DXY, US 10Y and 2Y yields (Federal Reserve H.15; yields use only the SMA50 and 20-day-change legs, in σ of daily changes) and, for gold, the TIPS ETF as a real-yield proxy (price up ≈ real yields down). Each is multiplied by a documented sign per instrument. Score = mean."],
    ["Risk regime", "VIX level (−tanh((VIX − 20)/6)), VIX trend and, except for equity indices, S&P 500 trend. Multiplied by the instrument's risk sensitivity (+1 risk-on bullish, −1 risk-on bearish, e.g. gold). Same convention as the Gold Intelligence panel (risk-off is a tailwind for gold)."],
    ["Cross-asset", "Three confirmers per instrument (shown in the table), trend score × sign. 'Confirmers agree' counts those whose signed score points the same way as the composite (|score| ≥ 0.10)."],
    ["Composite & driver agreement", `Composite = Σ w·score / Σ w over drivers with data. Label: Bullish ≥ +${LEAN_THRESHOLD}, Bearish ≤ −${LEAN_THRESHOLD}, otherwise Mixed. Agreement = |Σ w·score| / Σ w·|score|. Completeness = Σ w·(share of inputs present) / Σ w. Driver agreement = round(100 × agreement × completeness). ${DRIVER_AGREEMENT_NOTE} A missing input lowers completeness; it is never dropped silently.`],
    ["No look-ahead", "The instrument's own bars up to its last date; every other series only bars strictly before that date (daily bars of different markets close at different hours). COT reports count only after their Friday release."],
    ["Extension points", "Seasonality and macro-surprise drivers are intentionally not built here: add a DriverId in lib/lean/types.ts, a builder in lib/lean/score.ts and a base weight in lib/lean/config.ts."],
  ];
  return (
    <DataNote label="METHODOLOGY">
      <div className="flex flex-col gap-1.5" data-testid="lean-method">
        {rows.map(([k, v]) => <p key={k}><b>{k}.</b> {v}</p>)}
        <p><b>Weights.</b> A-priori weights {Object.entries(BASE_WEIGHTS).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}. A walk-forward test ({(backtest as any).start}–{(backtest as any).dataThrough}, generated {(backtest as any).generatedAt}) then scaled each driver by 1 or 0: a driver keeps its weight only if on the 2012–2019 train period its pooled 20-day agreement beat chance by at least one standard error. Result: {Object.entries(dec).map(([k, v]) => `${k} ${v.keep ? "kept" : "weight 0"} (z ${v.z == null ? "n/a" : v.z.toFixed(2)})`).join("; ")}. Zero-weight drivers are still computed and shown. Test-period (2020+) numbers never influenced a weight. Inputs: Yahoo Finance daily bars via OpenBB, Federal Reserve H.15, CFTC. Gold uses COMEX GC=F futures daily bars (roll gaps and basis vs spot); Twelve Data supplies only the live headline.</p>
        <p className="text-term-text">{DISCLAIMER} A lean describes what recent data point towards; it is not a prediction and never a buy or sell signal.</p>
      </div>
    </DataNote>
  );
}
