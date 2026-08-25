import { cn } from "@/lib/cn";
import { useCointegration } from "./useCointegration";

export function CointegrationPanel({ symbolA, symbolB, lookbackDays }: { symbolA: string; symbolB: string; lookbackDays: number }) {
  const { isLoading, isError, insufficientData, result } = useCointegration(symbolA, symbolB, lookbackDays);

  if (isLoading) return <Centered>RUNNING ENGLE-GRANGER TEST…</Centered>;
  if (isError) return <Centered error>Failed to run the cointegration test — is the quant service running (./start.sh)?</Centered>;
  if (insufficientData) return <Centered error>Not enough overlapping trading days between {symbolA} and {symbolB} for this lookback.</Centered>;
  if (!result) return <Centered>Enter two symbols above to test.</Centered>;

  const verdict = result.cointegrated_95;

  return (
    <div className="p-4 flex flex-col gap-4 max-w-xl">
      <div className={cn(
        "px-3 py-2 border text-[12px] font-semibold uppercase tracking-wider",
        verdict ? "border-term-green text-term-green bg-term-green/10" : "border-term-red text-term-red bg-term-red/10"
      )}>
        {symbolA} / {symbolB} — {verdict ? "Cointegrated at 95% confidence" : "Not cointegrated at 95% confidence"}
      </div>

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <Stat label="Test statistic" value={result.score.toFixed(4)} />
        <Stat label="p-value" value={result.pvalue < 0.0001 ? "< 0.0001" : result.pvalue.toFixed(4)} />
        <Stat label="Hedge ratio (β)" value={result.hedge_ratio.toFixed(4)} />
        <Stat label="Intercept" value={result.intercept.toFixed(4)} />
      </div>

      <div>
        <div className="sub-header mb-1">Critical values (Engle-Granger)</div>
        <div className="grid grid-cols-3 gap-3 text-[12px]">
          <Stat label="1%" value={result.critical_values["1%"].toFixed(4)} />
          <Stat label="5%" value={result.critical_values["5%"].toFixed(4)} />
          <Stat label="10%" value={result.critical_values["10%"].toFixed(4)} />
        </div>
      </div>

      <div className="text-term-muted text-[11px] leading-relaxed border-t border-term-border pt-3">
        Spread modeled as {symbolA} − {result.hedge_ratio.toFixed(3)} × {symbolB}. The test statistic must fall
        below a critical value (more negative) for the null of "no cointegration" to be rejected at that
        confidence level — see the Z-Score tab for the resulting spread.
      </div>
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

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={cn("p-6 text-[11px] uppercase tracking-widest", error ? "text-term-red" : "text-term-muted")}>
      {children}
    </div>
  );
}
