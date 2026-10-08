import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  useCotSnapshot, cotContract, cotCategory, fmtCotNum, fmtCotSigned, pctLabel, pctBand, PERCENTILE_DEFINITION,
} from "@/lib/cot";
import { CotStatus, CotLoading, CotError } from "@/components/CotStatus";
import { useWorkspace } from "@/store/workspaceStore";

/** The four contracts this panel has always shown (Gold, WTI, EUR FX, E-mini S&P 500), now read from the shared CFTC module. The full set lives on the COT page. */
const CONTRACTS = [
  { key: "gold", label: "Gold" },
  { key: "wti", label: "WTI Crude" },
  { key: "eur", label: "EUR FX" },
  { key: "es", label: "E-mini S&P 500" },
];

export function CotPanel() {
  const [key, setKey] = useState("gold");
  const openTab = useWorkspace((s) => s.openTab);
  const q = useCotSnapshot();
  const c = cotContract(q.data, key);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 h-8 px-3 border-b border-term-border bg-term-panel2 text-[10px] uppercase tracking-wider">
        {CONTRACTS.map((x) => (
          <button key={x.key} onClick={() => setKey(x.key)}
            className={cn("px-2 py-0.5 border",
              x.key === key ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {x.label}
          </button>
        ))}
        <button onClick={() => openTab("COT")} className="ml-auto normal-case tracking-normal text-term-muted hover:text-term-amber">
          All 14 contracts: COT →
        </button>
      </div>

      <div className="p-3 flex flex-col gap-3 overflow-auto scroll-thin">
        {q.isPending ? (
          <CotLoading what="CFTC COT report" />
        ) : q.isError ? (
          <CotError error={q.error} onRetry={() => q.refetch()} fetching={q.isFetching} />
        ) : !q.data || !c ? (
          <div className="text-term-muted text-[11px] uppercase tracking-widest">No COT data available.</div>
        ) : !c.available ? (
          <div className="text-term-muted text-[12px]">{c.name}: n/a — {c.reason}</div>
        ) : (
          <>
            <CotStatus snap={q.data} />
            <div className="sub-header">{c.name} · {c.market} · futures only</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-3xl">
              <Cell label={`${cotCategory(c).label} longs`} value={fmtCotNum(cotCategory(c).long)} change={cotCategory(c).changeLong} />
              <Cell label={`${cotCategory(c).label} shorts`} value={fmtCotNum(cotCategory(c).short)} change={cotCategory(c).changeShort} />
              <Cell label="Net position" value={fmtCotNum(cotCategory(c).net)} change={cotCategory(c).changeNet} />
              <Cell label="Open interest" value={fmtCotNum(c.openInterest)} change={c.openInterestChange} />
              <Cell label="Net percentile · 3Y" value={pctLabel(cotCategory(c).pct3y)} sub={pctBand(cotCategory(c).pct3y)} />
              <Cell label="Net percentile · 5Y" value={pctLabel(cotCategory(c).pct5y)} sub={pctBand(cotCategory(c).pct5y)} />
            </div>
            <div className="text-[10px] text-term-muted max-w-3xl">{PERCENTILE_DEFINITION}</div>
          </>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, change, sub }: { label: string; value: string; change?: number | null; sub?: string }) {
  return (
    <div className="px-2 py-1.5 border border-term-borderSoft">
      <div className="sub-header">{label}</div>
      <div className="num text-[15px] text-term-heading mt-0.5">{value}</div>
      {change != null && (
        <div className={cn("num text-[10px] mt-0.5", change >= 0 && "up", change < 0 && "down")}>{fmtCotSigned(change)} WoW</div>
      )}
      {sub && <div className="text-[10px] mt-0.5 text-term-muted">{sub}</div>}
    </div>
  );
}
