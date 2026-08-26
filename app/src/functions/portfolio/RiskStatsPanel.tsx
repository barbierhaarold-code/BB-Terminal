import { useMemo } from "react";
import { riskStats } from "@/lib/portfolio";
import { cn } from "@/lib/cn";
import { usePortfolioEquityCurve } from "./usePortfolioEquityCurve";

export function RiskStatsPanel() {
  const { positions, portfolioSeries, isLoading, isError } = usePortfolioEquityCurve();
  const stats = useMemo(() => riskStats(portfolioSeries, positions), [portfolioSeries, positions]);

  if (positions.length === 0) {
    return <div className="p-6 text-center text-term-muted text-[12px] uppercase tracking-widest">No positions yet.</div>;
  }
  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (isError) return <div className="p-4 text-term-red">Failed to load price history.</div>;

  const enoughData = portfolioSeries.length >= 3;

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl">
      {!enoughData && (
        <div className="text-term-muted text-[11px] uppercase tracking-widest">
          Not enough daily history yet to compute risk stats — check back after a few trading days.
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Sharpe Ratio" value={stats.sharpe != null ? stats.sharpe.toFixed(2) : "—"}
          tone={stats.sharpe == null ? undefined : stats.sharpe >= 0 ? "up" : "down"} />
        <Tile label="Ann. Volatility" value={stats.annualizedVolatility != null ? stats.annualizedVolatility.toFixed(1) + "%" : "—"} />
        <Tile label="Max Drawdown" value={stats.maxDrawdown != null ? stats.maxDrawdown.toFixed(1) + "%" : "—"}
          tone={stats.maxDrawdown == null ? undefined : "down"} />
        <Tile label="Win Rate" value={stats.winRate != null ? stats.winRate.toFixed(1) + "%" : "—"} />
      </div>
      <div className="text-term-muted text-[10px] uppercase tracking-[0.18em] leading-relaxed border-t border-term-border pt-3">
        Computed on the book's daily value series (since the earliest open position, weighted by shares).
        Sharpe/volatility annualized (√252, 0% risk-free). Win rate = % of days with a positive return.
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="border border-term-border px-3 py-2">
      <div className="sub-header">{label}</div>
      <div className={cn("num text-[18px] mt-1", tone === "up" && "up", tone === "down" && "down", !tone && "text-term-heading")}>
        {value}
      </div>
    </div>
  );
}
