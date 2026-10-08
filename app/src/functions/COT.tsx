import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, LineStyle, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { baseChartOptions, crosshairOptions, useChartTheme } from "@/lib/chartTheme";
import {
  useCotSnapshot, useCotHistory, cotCategory, fmtCotNum, fmtCotSigned, pctBand, pctLabel, PERCENTILE_DEFINITION,
  COT_CATEGORIES, COT_CONTRACT_BY_KEY, type CotContract, type CotContractOk, type CotHistoryPoint,
} from "@/lib/cot";
import { CotStatus, CotLoading, CotError } from "@/components/CotStatus";
import { DataNote, EmptyBlock } from "./research/shared";

const RANGES = [
  { label: "1Y", weeks: 52 },
  { label: "3Y", weeks: 156 },
  { label: "5Y", weeks: 260 },
  { label: "MAX", weeks: Infinity },
];

export function COT() {
  const q = useCotSnapshot();
  const [selKey, setSelKey] = useState("gold");
  const [catId, setCatId] = useState<string | null>(null);

  const snap = q.data;
  const selected = snap?.contracts.find((c) => c.key === selKey);

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">COMMITMENTS OF TRADERS</span>
            <span className="text-term-muted text-[11px]">CFTC · futures only · weekly</span>
          </div>
          {snap && <CotStatus snap={snap} />}
        </div>
        <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5">
          <RefreshCw size={13} className={cn(q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.isPending && <CotLoading what="CFTC COT report" />}
      {q.isError && !q.isPending && <CotError error={q.error} onRetry={() => q.refetch()} fetching={q.isFetching} />}
      {snap && snap.contracts.every((c) => !c.available) && (
        <EmptyBlock>No contract data available from the CFTC right now.</EmptyBlock>
      )}

      {snap && snap.contracts.some((c) => c.available) && (
        <>
          <ContractTable
            contracts={snap.contracts}
            selKey={selKey}
            onSelect={(k) => { setSelKey(k); setCatId(null); }}
          />
          {selected && (
            <Detail contract={selected} catId={catId} onCat={setCatId} />
          )}
        </>
      )}

      <DataNote>
        <p className="mb-1.5">
          The CFTC publishes the Commitments of Traders report every Friday at 3:30 pm US Eastern. It shows who held
          futures positions as of the <b>previous Tuesday</b>, so every number here is at least three days old and is never live
          (holiday weeks can delay it). Figures cover <b>futures only</b> (no options).
        </p>
        <p className="mb-1.5">
          <b>Who the groups are.</b> Financial contracts (FX, indices, Bitcoin) use the Traders in Financial Futures report:{" "}
          {COT_CATEGORIES.tff.map((c) => <span key={c.id}><b>{c.label}</b>: {c.desc}{" "}</span>)}
        </p>
        <p className="mb-1.5">
          Gold, silver and WTI use the Disaggregated report:{" "}
          {COT_CATEGORIES.disagg.map((c) => <span key={c.id}><b>{c.label}</b>: {c.desc}{" "}</span>)}
        </p>
        <p className="mb-1.5">
          <b>Net</b> = long minus short for a group (spread positions excluded). Every long has a matching short in the same
          market, so the groups' nets roughly offset one another. A group's position can reflect hedging or relative-value trades
          rather than a directional view: in equity index futures, for example, leveraged funds are often short against other
          groups' long positions, so read extremes as context, not a signal. The headline group is Leveraged Funds for financial contracts and
          Managed Money for commodities, the groups closest to speculators.
        </p>
        <p>
          <b>How to read extremes.</b> {PERCENTILE_DEFINITION} A reading near 100 or near 0 only says positioning is at the edge of
          its own recent range, that is, how one-sided or crowded it is. It does not say what price will do next: extremes can
          persist for months, and the data is days old by the time you read it. Treat it as context, not a signal.
        </p>
      </DataNote>
    </div>
  );
}

// ───────────── contract table ─────────────

function ContractTable({ contracts, selKey, onSelect }: { contracts: CotContract[]; selKey: string; onSelect: (k: string) => void }) {
  return (
    <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
      <table className="w-full min-w-[860px] text-[12px]" data-testid="cot-table">
        <thead>
          <tr className="text-left sub-header border-b border-term-borderSoft">
            <th className="px-2 py-1.5 font-normal">Contract</th>
            <th className="px-2 py-1.5 font-normal">Headline group</th>
            <th className="px-2 py-1.5 font-normal text-right">Net</th>
            <th className="px-2 py-1.5 font-normal text-right">Δ week</th>
            <th className="px-2 py-1.5 font-normal text-right">Open interest</th>
            <th className="px-2 py-1.5 font-normal text-right">3Y pctl</th>
            <th className="px-2 py-1.5 font-normal text-right">5Y pctl</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => {
            const def = COT_CONTRACT_BY_KEY[c.key];
            const active = c.key === selKey;
            if (!c.available) {
              return (
                <tr key={c.key} onClick={() => onSelect(c.key)} title={c.reason}
                  className={cn("border-b border-term-borderSoft cursor-pointer hover:bg-term-amberSubtle", active && "bg-term-amberSubtle")}>
                  <td className="px-2 py-1.5"><span className="text-term-heading">{c.name}</span> <span className="text-term-muted text-[10px]">{def?.code}</span></td>
                  <td className="px-2 py-1.5 text-term-muted">n/a</td>
                  <td className="px-2 py-1.5 text-right num text-term-muted">n/a</td>
                  <td className="px-2 py-1.5 text-right num text-term-muted">n/a</td>
                  <td className="px-2 py-1.5 text-right num text-term-muted">n/a</td>
                  <td className="px-2 py-1.5 text-right num text-term-muted">n/a</td>
                  <td className="px-2 py-1.5 text-right num text-term-muted">n/a</td>
                </tr>
              );
            }
            const r = cotCategory(c);
            return (
              <tr key={c.key} onClick={() => onSelect(c.key)} data-testid={`cot-row-${c.key}`}
                className={cn("border-b border-term-borderSoft cursor-pointer hover:bg-term-amberSubtle", active && "bg-term-amberSubtle")}>
                <td className="px-2 py-1.5">
                  <span className="text-term-heading">{c.name}</span>{" "}
                  <span className="text-term-muted text-[10px]">{c.code} · {r.id === "noncomm" ? "LEGACY" : c.report === "tff" ? "TFF" : "DISAGG"}</span>
                </td>
                <td className="px-2 py-1.5 text-term-muted">{r.label}</td>
                <td className="px-2 py-1.5 text-right num text-term-heading">{fmtCotNum(r.net)}</td>
                <td className={cn("px-2 py-1.5 text-right num", r.changeNet != null && (r.changeNet >= 0 ? "up" : "down"))}>{fmtCotSigned(r.changeNet)}</td>
                <td className="px-2 py-1.5 text-right num">{fmtCotNum(c.openInterest)}</td>
                <td className="px-2 py-1.5 text-right"><Pctl value={r.pct3y} /></td>
                <td className="px-2 py-1.5 text-right"><Pctl value={r.pct5y} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Percentile number + a thin bar. Violet, never green/red: a percentile is a position in a range, not a direction. */
function Pctl({ value }: { value: number | null }) {
  if (value == null) return <span className="num text-term-muted">n/a</span>;
  const extreme = value >= 90 || value <= 10;
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="hidden sm:block w-16 h-1 bg-term-border relative">
        <span className="absolute inset-y-0 left-0 bg-term-amber" style={{ width: `${Math.max(2, value)}%`, opacity: extreme ? 1 : 0.55 }} />
      </span>
      <span className={cn("num w-7 text-right", extreme ? "text-term-amber font-bold" : "text-term-text")} title={pctBand(value)}>{pctLabel(value)}</span>
    </span>
  );
}

// ───────────── detail: groups + history chart ─────────────

function Detail({ contract, catId, onCat }: { contract: CotContract; catId: string | null; onCat: (id: string | null) => void }) {
  if (!contract.available) {
    return (
      <div className="border border-term-borderSoft p-3 text-term-muted" data-testid="cot-detail">
        <span className="text-term-heading">{contract.name}</span>: n/a — {contract.reason}
      </div>
    );
  }
  return <DetailOk contract={contract} catId={catId} onCat={onCat} />;
}

function DetailOk({ contract, catId, onCat }: { contract: CotContractOk; catId: string | null; onCat: (id: string | null) => void }) {
  const hist = useCotHistory(contract.key);
  const [range, setRange] = useState(RANGES[1]);
  const activeCat = cotCategory(contract, catId ?? undefined);

  return (
    <div className="border border-term-borderSoft" data-testid="cot-detail">
      <div className="px-2 py-1.5 flex items-center justify-between gap-3 flex-wrap border-b border-term-borderSoft">
        <span className="sub-header">{contract.market}</span>
        <span className="sub-header normal-case tracking-normal font-normal num">
          OI {fmtCotNum(contract.openInterest)} ({fmtCotSigned(contract.openInterestChange)} wk) · {contract.weeks} weekly reports loaded
        </span>
      </div>

      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead>
            <tr className="text-left sub-header border-b border-term-borderSoft">
              <th className="px-2 py-1 font-normal">Group</th>
              <th className="px-2 py-1 font-normal text-right">Long</th>
              <th className="px-2 py-1 font-normal text-right">Short</th>
              <th className="px-2 py-1 font-normal text-right">Net</th>
              <th className="px-2 py-1 font-normal text-right">Δ week</th>
              <th className="px-2 py-1 font-normal text-right">3Y pctl</th>
              <th className="px-2 py-1 font-normal text-right">5Y pctl</th>
            </tr>
          </thead>
          <tbody>
            {contract.categories.map((r) => (
              <tr key={r.id} onClick={() => onCat(r.id)} data-testid={`cot-cat-${r.id}`}
                className={cn("border-b border-term-borderSoft cursor-pointer hover:bg-term-amberSubtle", r.id === activeCat.id && "bg-term-amberSubtle")}>
                <td className="px-2 py-1">
                  <span className={cn(r.id === activeCat.id ? "text-term-amber" : "text-term-heading")}>{r.label}</span>
                  {r.id === contract.primary && <span className="ml-2 text-[9px] uppercase tracking-wider text-term-muted border border-term-borderSoft px-1">headline</span>}
                </td>
                <td className="px-2 py-1 text-right num">{fmtCotNum(r.long)}</td>
                <td className="px-2 py-1 text-right num">{fmtCotNum(r.short)}</td>
                <td className="px-2 py-1 text-right num text-term-heading">{fmtCotNum(r.net)}</td>
                <td className={cn("px-2 py-1 text-right num", r.changeNet != null && (r.changeNet >= 0 ? "up" : "down"))}>{fmtCotSigned(r.changeNet)}</td>
                <td className="px-2 py-1 text-right"><Pctl value={r.pct3y} /></td>
                <td className="px-2 py-1 text-right"><Pctl value={r.pct5y} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 px-2 h-8 border-t border-b border-term-borderSoft bg-term-panel2 text-[10px] uppercase tracking-wider">
        <span className="text-term-muted">Net position · {activeCat.label}</span>
        <div className="ml-auto flex items-center gap-1">
          {RANGES.map((r) => (
            <button key={r.label} onClick={() => setRange(r)}
              className={cn("px-1.5 py-0.5 border", r.label === range.label ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[280px] relative">
        {hist.isPending && <CotLoading what="history" />}
        {hist.isError && !hist.isPending && <CotError error={hist.error} onRetry={() => hist.refetch()} fetching={hist.isFetching} />}
        {hist.data && hist.data.history.length === 0 && <EmptyBlock>No history for this contract.</EmptyBlock>}
        {hist.data && hist.data.history.length > 0 && (
          <NetChart history={hist.data.history} catId={activeCat.id} weeks={range.weeks} />
        )}
      </div>
      <div className="px-2 py-1 text-[10px] text-term-muted border-t border-term-borderSoft">{PERCENTILE_DEFINITION}</div>
    </div>
  );
}

function NetChart({ history, catId, weeks }: { history: CotHistoryPoint[]; catId: string; weeks: number }) {
  const ct = useChartTheme();
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const data = useMemo(() => {
    const slice = Number.isFinite(weeks) ? history.slice(-weeks) : history;
    return slice.filter((p) => p.nets[catId] != null).map((p) => ({ time: p.date, value: p.nets[catId] }));
  }, [history, catId, weeks]);

  useEffect(() => {
    if (!ref.current) return;
    const base = baseChartOptions(ct);
    const chart = createChart(ref.current, {
      ...base,
      localization: { locale: "en-US" }, // English-only UI regardless of browser locale
      timeScale: { ...base.timeScale, timeVisible: false },
      crosshair: {
        vertLine: { ...crosshairOptions(ct).vertLine, width: 1, style: LineStyle.Dashed },
        horzLine: { ...crosshairOptions(ct).horzLine, width: 1, style: LineStyle.Dashed },
      },
      autoSize: true,
    });
    const s = chart.addLineSeries({
      color: ct.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (v: number) => fmtCotNum(v), minMove: 1 },
    });
    s.createPriceLine({ price: 0, color: ct.refLine, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    chartRef.current = chart; seriesRef.current = s;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      ...baseChartOptions(ct),
      crosshair: { vertLine: crosshairOptions(ct).vertLine, horzLine: crosshairOptions(ct).horzLine },
    });
    seriesRef.current?.applyOptions({ color: ct.accent });
  }, [ct]);

  useEffect(() => {
    seriesRef.current?.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={ref} className="absolute inset-0" data-testid="cot-chart" />;
}
