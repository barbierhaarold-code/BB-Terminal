import { useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { MANAGER_BY_CIK, THIRTEEN_F_NOTE } from "@/lib/holdings/config";
import { displayTicker, fmtUsd } from "@/lib/holdings/math";
import { retryHold, useHoldStatus, useHolders, useManager, useManagers, useTickers } from "@/lib/holdings/client";
import type { ChangeStatus, HoldingRow, HoldStatus } from "@/lib/holdings/types";
import { dateLabel, periodLabel } from "@/lib/macro/math";
import { DataNote, EmptyBlock } from "./research/shared";

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text focus:outline-none focus:border-term-amber";
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (n: number, d = 2) => `${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;

type Tab = "managers" | "holders";

export function HOLD() {
  const qc = useQueryClient();
  const statusQ = useHoldStatus();
  const st = statusQ.data;
  const ready = !!st && st.state !== "missing_contact" && (st.state === "ready" || st.state === "mapping");
  const [tab, setTab] = useState<Tab>("managers");

  const retry = async () => { try { await retryHold(); } catch { /* the status query below shows the cause */ } await qc.invalidateQueries({ queryKey: ["hold"] }); };

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">INSTITUTIONAL HOLDINGS</span>
            <span className="text-term-muted text-[11px]">SEC Form 13F-HR · quarterly · descriptive · not real-time</span>
          </div>
          {st && st.state !== "missing_contact" && st.latestPeriod && (
            <div className="text-[11px] num text-term-text" data-testid="hold-status">
              Latest period of report {periodLabel(st.latestPeriod)} · index built {dateLabel(st.builtAt)} · source: SEC bulk Form 13F data sets ({st.dataSets.length})
            </div>
          )}
        </div>
        <button onClick={() => qc.invalidateQueries({ queryKey: ["hold"] })} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5" data-testid="hold-refresh">
          <RefreshCw size={13} className={cn(statusQ.isFetching && "animate-spin")} />
        </button>
      </div>

      <DataNote label="13F LIMITS">{THIRTEEN_F_NOTE}</DataNote>

      {statusQ.isPending && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]" data-testid="hold-loading">Loading holdings status…</div>}
      {statusQ.isError && !statusQ.isPending && <HoldError message={(statusQ.error as Error).message} onRetry={retry} fetching={statusQ.isFetching} />}
      {st?.state === "missing_contact" && <HoldError tone="amber" testid="hold-missing-contact" label="SEC CONTACT EMAIL MISSING" message={st.message} onRetry={retry} fetching={statusQ.isFetching} />}
      {st && st.state !== "missing_contact" && <Progress st={st} onRetry={retry} fetching={statusQ.isFetching} />}

      {ready && (
        <>
          <div className="flex items-center gap-2">
            {(["managers", "holders"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} data-testid={`hold-tab-${t}`}
                className={cn("px-3 py-1 border text-[11px] uppercase tracking-wider", tab === t ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-amber")}>
                {t === "managers" ? "Managers" : "Who holds a stock"}
              </button>
            ))}
          </div>
          {tab === "managers" ? <ManagersView /> : <HoldersView st={st!} />}
        </>
      )}

      <About />
    </div>
  );
}

function Banner({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className="flex items-start gap-2 border border-term-amber/60 bg-term-amberSubtle px-2 py-1 text-[11px] leading-snug text-term-text">
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-term-amber" /><span>{children}</span>
    </div>
  );
}

function HoldError({ message, onRetry, fetching, tone, testid, label }: { message: string; onRetry: () => void; fetching?: boolean; tone?: "amber"; testid?: string; label?: string }) {
  const c = tone === "amber" ? "text-term-amber" : "text-term-red";
  return (
    <div className={cn("p-3 flex flex-col items-start gap-2 text-[12px]", c)} role="alert" data-testid={testid ?? "hold-error"}>
      <div><span className={cn("sub-header mr-1", c)}>{label ?? "ERROR"}</span>{message}</div>
      <button onClick={onRetry} className="px-2 py-1 border border-current text-[11px] uppercase tracking-wider hover:bg-term-amberSubtle flex items-center gap-1.5">
        <RefreshCw size={11} className={cn(fetching && "animate-spin")} /> Retry
      </button>
    </div>
  );
}

function Progress({ st, onRetry, fetching }: { st: Exclude<HoldStatus, { state: "missing_contact" }>; onRetry: () => void; fetching?: boolean }) {
  if (st.state === "error" || (st.message && st.state !== "mapping" && !st.builtAt)) return <HoldError message={st.message ?? "The holdings index could not be built."} onRetry={onRetry} fetching={fetching} />;
  if (st.state === "building" || st.state === "idle") return <Banner testid="hold-building"><b>Building the holdings index</b> — {st.phase}. The SEC's bulk data (about 200 MB) is read once a day; the first build takes a few minutes. This page updates by itself.</Banner>;
  if (st.state === "mapping") return <Banner testid="hold-mapping"><b>Mapping securities to tickers</b> — {st.mapping.done}/{st.mapping.total} CUSIPs (OpenFIGI, exact matches only, about 25 requests a minute). Positions without a confirmed match show the issuer name and CUSIP and no ticker.{st.message ? ` ${st.message}` : ""}</Banner>;
  if (st.message) return <Banner testid="hold-warning">{st.message}</Banner>;
  return null;
}

// ───────────── managers ─────────────

const STATUS_LABEL: Record<ChangeStatus, string> = { new: "NEW", added: "ADDED", reduced: "REDUCED", unchanged: "UNCHANGED", exited: "EXITED", unknown: "n/a" };

function ChangeChip({ r }: { r: HoldingRow }) {
  if (r.status === "unchanged" || r.status === "unknown") return <span className="text-term-muted text-[10px]">{STATUS_LABEL[r.status]}</span>;
  return (
    <span data-testid={`hold-change-${r.status}`} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber whitespace-nowrap">
      {STATUS_LABEL[r.status]}{r.sharesChangePct != null ? ` ${r.sharesChangePct > 0 ? "+" : "−"}${Math.abs(r.sharesChangePct).toFixed(1)}%` : ""}
    </span>
  );
}

function PosName({ r }: { r: HoldingRow }) {
  return (
    <div>
      <div className="text-term-heading">{r.ticker ? <span className="num mr-1.5" data-testid="hold-ticker">{displayTicker(r.ticker)}</span> : null}{r.issuer}{r.putCall ? <span className="text-term-muted"> · {r.putCall}s</span> : null}</div>
      <div className="text-term-muted text-[10px] num">{r.titleOfClass} · CUSIP {r.cusip}{r.ticker ? "" : " · no confirmed ticker"}</div>
    </div>
  );
}

function ManagersView() {
  const mq = useManagers();
  const [cik, setCik] = useState<string | null>(null);
  const list = mq.data?.managers ?? [];
  const sel = cik ?? list[0]?.cik ?? null;
  const pq = useManager(sel, !!mq.data);
  const p = pq.data;

  if (mq.isPending) return <div className="text-term-muted uppercase tracking-widest text-[11px]" data-testid="hold-managers-loading">Loading managers…</div>;
  if (mq.isError) return <HoldError message={(mq.error as Error).message} onRetry={() => mq.refetch()} fetching={mq.isFetching} />;
  if (list.length === 0) return <EmptyBlock>No curated manager has a 13F-HR in the latest data set.</EmptyBlock>;

  return (
    <div className="flex flex-col gap-3" data-testid="hold-managers">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="sub-header">Manager</span>
        <select value={sel ?? ""} onChange={(e) => setCik(e.target.value)} className={cn(inputCls, "min-w-[280px]")} aria-label="Manager" data-testid="hold-manager-select">
          {list.map((m) => <option key={m.cik} value={m.cik}>{m.name} — {fmtUsd(m.totalValue)}</option>)}
        </select>
        <span className="text-term-muted text-[11px]">{list.length} curated managers · CIKs resolved from SEC data</span>
      </div>

      {pq.isPending && <div className="text-term-muted uppercase tracking-widest text-[11px]">Loading holdings…</div>}
      {pq.isError && <HoldError message={(pq.error as Error).message} onRetry={() => pq.refetch()} fetching={pq.isFetching} />}
      {p && (
        <>
          <div className="border border-term-borderSoft px-3 py-2 flex flex-col gap-1" data-testid="hold-manager-head">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-term-heading">{p.name}</span>
              <span className="text-term-muted text-[11px]">{MANAGER_BY_CIK[p.cik]?.group} · CIK {p.cik}</span>
            </div>
            <div className="text-[11px] num text-term-text" data-testid="hold-dates">
              Period of report {periodLabel(p.filing.periodOfReport)} · filed {dateLabel(p.filing.filingDate)} · accession {p.filing.accession}
              {p.previousFiling ? <> · compared with {periodLabel(p.previousFiling.periodOfReport)} (filed {dateLabel(p.previousFiling.filingDate)})</> : <> · no earlier 13F-HR found in the data, so no change is shown</>}
            </div>
            <div className="text-[11px] num text-term-muted">
              Reported total {fmtUsd(p.totalValue)} · {num(p.positionCount)} positions{p.positionCount > p.rows.length ? ` (largest ${p.rows.length} shown)` : ""}
              {" · "}<a className="underline hover:text-term-amber" target="_blank" rel="noreferrer noopener" href={`https://www.sec.gov/Archives/edgar/data/${Number(p.cik)}/${p.filing.accession.replace(/-/g, "")}/`}>Filing on sec.gov</a>
            </div>
            {p.newerFiling && <div className="text-[11px] text-term-text" data-testid="hold-newer">A newer 13F-HR exists on sec.gov (period {periodLabel(p.newerFiling.periodOfReport)}, filed {dateLabel(p.newerFiling.filingDate)}) that is not in the bulk data set yet; the figures below are for the earlier period.</div>}
          </div>

          <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
            <table className="w-full min-w-[860px] text-[12px]" data-testid="hold-table">
              <thead><tr className="text-left sub-header border-b border-term-borderSoft">
                <th className="px-2 py-1.5 font-normal">Position</th><th className="px-2 py-1.5 font-normal text-right">Shares</th><th className="px-2 py-1.5 font-normal text-right">Value</th>
                <th className="px-2 py-1.5 font-normal text-right">% of portfolio</th><th className="px-2 py-1.5 font-normal text-right">Previous shares</th><th className="px-2 py-1.5 font-normal">Change vs previous quarter</th>
              </tr></thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={`${r.cusip}|${r.putCall}|${r.sharesType}`} className="border-b border-term-borderSoft align-top" data-testid="hold-row">
                    <td className="px-2 py-1.5"><PosName r={r} /></td>
                    <td className="px-2 py-1.5 text-right num">{num(r.shares)}{r.sharesType === "PRN" ? <div className="text-[10px] text-term-muted">principal</div> : null}</td>
                    <td className="px-2 py-1.5 text-right num text-term-heading">{fmtUsd(r.value)}</td>
                    <td className="px-2 py-1.5 text-right num">{pct(r.pct)}</td>
                    <td className="px-2 py-1.5 text-right num text-term-muted">{r.prevShares == null ? "n/a" : num(r.prevShares)}</td>
                    <td className="px-2 py-1.5"><ChangeChip r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.exited.length > 0 && (
            <div className="flex flex-col gap-1" data-testid="hold-exited">
              <span className="sub-header">Exited since the previous quarter (largest by previous shares value)</span>
              <div className="text-[11px] text-term-muted">{p.exited.map((r) => `${r.ticker ? displayTicker(r.ticker) + " " : ""}${r.issuer}${r.putCall ? ` (${r.putCall}s)` : ""}`).join(" · ")}</div>
            </div>
          )}
          <div className="text-[10px] text-term-muted">Change compares share counts between the two filings (a price move alone is not a trade). Percentages are of the filing's reported total. No value is colour-coded.</div>
        </>
      )}
    </div>
  );
}

// ───────────── reverse: who holds this stock ─────────────

function HoldersView({ st }: { st: Exclude<HoldStatus, { state: "missing_contact" }> }) {
  const tq = useTickers();
  const [input, setInput] = useState("");
  const [ticker, setTicker] = useState<string | null>(null);
  const hq = useHolders(ticker);
  const suggestions = useMemo(() => tq.data?.tickers.slice(0, 300) ?? [], [tq.data]);
  const submit = () => { const t = input.trim().toUpperCase(); if (t) setTicker(t); };
  const h = hq.data;
  return (
    <div className="flex flex-col gap-3" data-testid="hold-holders">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="sub-header">Ticker</span>
        <input list="hold-tickers" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. AAPL" className={cn(inputCls, "w-40 uppercase")} aria-label="Ticker" data-testid="hold-ticker-input" />
        <datalist id="hold-tickers">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>
        <button onClick={submit} className="px-2 py-1 border border-term-amber text-term-amber text-[11px] uppercase tracking-wider hover:bg-term-amberSubtle" data-testid="hold-lookup">Show holders</button>
        <span className="text-term-muted text-[11px]">{tq.data ? `${tq.data.tickers.length} tickers with a confirmed CUSIP match${tq.data.mappingDone ? "" : " so far (mapping still running)"}` : ""}</span>
      </div>
      <div className="text-[11px] text-term-muted">Largest holders among all 13F-HR filers for the latest period ({st.latestPeriod ? periodLabel(st.latestPeriod) : "n/a"}), from the SEC's bulk data. Securities are matched to tickers only on an exact CUSIP match; otherwise no holder list is shown.</div>
      {!ticker && <EmptyBlock>Enter a ticker to see who holds it.</EmptyBlock>}
      {ticker && hq.isPending && <div className="text-term-muted uppercase tracking-widest text-[11px]">Loading holders…</div>}
      {ticker && hq.isError && <HoldError message={(hq.error as Error).message} onRetry={() => hq.refetch()} fetching={hq.isFetching} />}
      {h && <HolderTable h={h} />}
    </div>
  );
}

export function HolderTable({ h, limit }: { h: NonNullable<ReturnType<typeof useHolders>["data"]>; limit?: number }) {
  const rows = limit ? h.holders.slice(0, limit) : h.holders;
  return (
    <div className="flex flex-col gap-1.5" data-testid="hold-holder-table">
      <div className="text-[11px] num text-term-text">
        {displayTicker(h.ticker)} · {h.issuer} · CUSIP {h.cusip} · period of report {periodLabel(h.periodOfReport)} · {num(h.holderCount)} filers hold it, {fmtUsd(h.totalValueAllFilers)} in total (as filed)
      </div>
      {h.note && <div className="text-[10px] text-term-muted">{h.note}</div>}
      <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
        <table className="w-full min-w-[560px] text-[12px]">
          <thead><tr className="text-left sub-header border-b border-term-borderSoft">
            <th className="px-2 py-1.5 font-normal">#</th><th className="px-2 py-1.5 font-normal">Holder</th><th className="px-2 py-1.5 font-normal text-right">Shares</th>
            <th className="px-2 py-1.5 font-normal text-right">Value</th><th className="px-2 py-1.5 font-normal text-right">% of all reported</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.cik} className="border-b border-term-borderSoft" data-testid="hold-holder-row">
                <td className="px-2 py-1.5 text-term-muted num">{i + 1}</td>
                <td className="px-2 py-1.5 text-term-heading">{r.name}<span className="text-term-muted text-[10px] num"> · CIK {r.cik}</span></td>
                <td className="px-2 py-1.5 text-right num">{num(r.shares)}</td>
                <td className="px-2 py-1.5 text-right num text-term-heading">{fmtUsd(r.value)}</td>
                <td className="px-2 py-1.5 text-right num">{h.totalValueAllFilers ? pct((r.value / h.totalValueAllFilers) * 100) : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function About() {
  return (
    <DataNote>
      <p className="mb-1.5"><b>What this is.</b> Who holds what, according to the SEC's Form 13F: every US institutional manager above $100 million must report its long US-listed positions once a quarter. This page shows about 30 well-known managers (with the change versus the previous quarter) and, for each major security, the largest holders among all filers.</p>
      <p className="mb-1.5"><b>How to read it.</b> The "period of report" is the quarter-end the positions are as of; the filing date is when it was filed (up to 45 days after quarter end). Everything is therefore weeks old, and a holding can have been sold since. Options (puts and calls) are separate lines and are not the same as owning shares. A position that is not in a filing may simply be below the reporting rules, held abroad, or short.</p>
      <p className="mb-1.5"><b>Change versus the previous quarter</b> compares share counts between the two filings: NEW (not held before), ADDED / REDUCED (percent change in shares), UNCHANGED, EXITED (held before, gone now). It describes what was filed and implies nothing about whether a move was wise.</p>
      <p><b>Source and limits.</b> SEC EDGAR: the official Form 13F bulk data sets and data.sec.gov submissions; tickers come from exact CUSIP matches (OpenFIGI) and are left blank when the match is not certain. The SEC's published reporting units are whole US dollars; a few filers report values in the wrong units, and such managers were left out of the curated list. Not real-time, not a signal, not investment advice.</p>
    </DataNote>
  );
}
