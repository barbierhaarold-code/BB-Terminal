import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCot, COT_CONTRACT_LABELS, type CotContract } from "@/lib/api";
import { fmtInt, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

const CONTRACTS = Object.keys(COT_CONTRACT_LABELS) as CotContract[];

export function CotPanel() {
  const [contract, setContract] = useState<CotContract>("gold");
  const cot = useQuery({
    queryKey: ["quant-cot", contract],
    queryFn: () => fetchCot(contract),
    staleTime: 6 * 60 * 60_000,
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 h-8 px-3 border-b border-term-border bg-term-panel2 text-[10px] uppercase tracking-wider">
        {CONTRACTS.map((c) => (
          <button key={c} onClick={() => setContract(c)}
            className={cn("px-2 py-0.5 border",
              c === contract ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {COT_CONTRACT_LABELS[c]}
          </button>
        ))}
        {cot.data && <span className="sub-header normal-case tracking-normal font-normal ml-auto">as of {fmtDate(cot.data.asOf)}</span>}
      </div>

      <div className="p-3">
        {cot.isLoading ? (
          <div className="text-term-muted text-[11px]">Loading CFTC legacy futures-only report…</div>
        ) : cot.isError || !cot.data ? (
          <div className="text-term-red text-[12px]">{(cot.error as Error)?.message ?? "COT report unavailable."}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
            <Cell label="Non-comm. longs" value={fmtInt(cot.data.nonCommercialLong)} change={cot.data.nonCommercialLongChange} />
            <Cell label="Non-comm. shorts" value={fmtInt(cot.data.nonCommercialShort)} change={cot.data.nonCommercialShortChange} />
            <Cell
              label="Net position"
              value={fmtInt(cot.data.nonCommercialLong - cot.data.nonCommercialShort)}
              change={cot.data.nonCommercialLongChange - cot.data.nonCommercialShortChange}
            />
            <Cell label="Open interest" value={fmtInt(cot.data.openInterest)} />
            <Cell
              label="Long % of longs+shorts"
              value={fmtPct((cot.data.nonCommercialLong / (cot.data.nonCommercialLong + cot.data.nonCommercialShort)) * 100, 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, change }: { label: string; value: string; change?: number }) {
  return (
    <div className="px-2 py-1.5 border border-term-borderSoft">
      <div className="sub-header">{label}</div>
      <div className="num text-[15px] text-term-heading mt-0.5">{value}</div>
      {change != null && (
        <div className={cn("num text-[10px] mt-0.5", change >= 0 && "up", change < 0 && "down")}>
          {change >= 0 ? "+" : ""}{fmtInt(change)} WoW
        </div>
      )}
    </div>
  );
}
