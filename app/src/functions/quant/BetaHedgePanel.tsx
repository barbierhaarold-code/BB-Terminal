import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchHistorical } from "@/lib/api";
import { alignByDate, pctReturns, linreg } from "@/lib/correlation";
import { cn } from "@/lib/cn";
import { useCointegration } from "./useCointegration";

const BENCHMARKS = ["SPY", "QQQ", "DIA", "IWM"];

export function BetaHedgePanel({ symbolA, symbolB, lookbackDays }: { symbolA: string; symbolB: string; lookbackDays: number }) {
  const [benchmark, setBenchmark] = useState("SPY");
  const startDate = useMemo(
    () => new Date(Date.now() - lookbackDays * 864e5).toISOString().slice(0, 10),
    [lookbackDays]
  );

  const qStock = useQuery({
    queryKey: ["quant-beta-stock", symbolA, lookbackDays],
    queryFn: () => fetchHistorical(symbolA, { interval: "1d", start_date: startDate }),
    enabled: !!symbolA,
    staleTime: 60_000,
  });
  const qBench = useQuery({
    queryKey: ["quant-beta-bench", benchmark, lookbackDays],
    queryFn: () => fetchHistorical(benchmark, { interval: "1d", start_date: startDate }),
    staleTime: 60_000,
  });

  const beta = useMemo(() => {
    if (!qStock.data || !qBench.data) return undefined;
    const [sc, bc] = alignByDate(qStock.data, qBench.data);
    return linreg(pctReturns(bc), pctReturns(sc));
  }, [qStock.data, qBench.data]);

  const hedge = useCointegration(symbolA, symbolB, lookbackDays);

  const isLoading = qStock.isLoading || qBench.isLoading;
  const isError = qStock.isError || qBench.isError;

  return (
    <div className="p-4 flex flex-col gap-6 max-w-2xl">
      <section>
        <div className="sub-header mb-2">Beta vs. benchmark</div>
        <div className="flex items-center gap-1 mb-3">
          {BENCHMARKS.map((b) => (
            <button key={b} onClick={() => setBenchmark(b)}
              className={cn("px-2 py-0.5 border text-[10px] uppercase tracking-wider",
                b === benchmark ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text")}>
              {b}
            </button>
          ))}
        </div>
        {isLoading && <div className="text-term-muted text-[11px]">Loading…</div>}
        {isError && <div className="text-term-red text-[11px]">Failed to load price history.</div>}
        {!isLoading && !isError && (
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <Stat label={`β (${symbolA} vs ${benchmark})`} value={beta ? beta.slope.toFixed(3) : "—"} />
            <Stat label="R²" value={beta ? beta.r2.toFixed(3) : "—"} />
          </div>
        )}
      </section>

      <section>
        <div className="sub-header mb-2">Pair hedge ratio</div>
        {hedge.isLoading && <div className="text-term-muted text-[11px]">Loading…</div>}
        {hedge.isError && <div className="text-term-red text-[11px]">Failed to load — is the quant service running (./start.sh)?</div>}
        {hedge.insufficientData && <div className="text-term-red text-[11px]">Not enough overlapping trading days.</div>}
        {hedge.result && (
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <Stat label={`Hedge ratio (${symbolA} / ${symbolB})`} value={hedge.result.hedge_ratio.toFixed(4)} />
            <Stat label="Per 1 unit long" value={`short ${hedge.result.hedge_ratio.toFixed(2)} ${symbolB}`} />
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-term-border px-2 py-1.5">
      <div className="sub-header">{label}</div>
      <div className="num text-term-heading text-[13px]">{value}</div>
    </div>
  );
}
