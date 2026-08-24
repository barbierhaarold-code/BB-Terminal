import { useQuery } from "@tanstack/react-query";
import { fetchMetrics } from "@/lib/api";
import {
  sigMargin, sigGrowth, sigROE, sigROA, sigPE, sigFwdPE, sigEvEbitda, sigDebtEquity,
  gradeFromSignals, gradeColor, levelDot, type Signal,
} from "@/lib/signals";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock } from "./shared";

/** Grade scorecard — extends lib/signals.ts (gradeFromSignals) rather than
 * re-encoding thresholds here; every grade is built from the same sig*
 * classifiers INTEL already uses. */
export function FundamentalsTab({ symbol }: { symbol: string }) {
  const { data: m, isLoading, error } = useQuery({ queryKey: ["metrics", symbol], queryFn: () => fetchMetrics(symbol) });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBlock err={error as Error} />;
  if (!m) return <EmptyBlock>No fundamentals for {symbol}.</EmptyBlock>;

  const profitability: Signal[] = [sigMargin(m.gross_margin, "gross"), sigMargin(m.operating_margin, "op"), sigMargin(m.profit_margin, "net")];
  const growth: Signal[] = [sigGrowth(m.revenue_growth, "Revenue"), sigGrowth(m.earnings_growth, "Earnings")];
  const quality: Signal[] = [sigROE(m.return_on_equity), sigROA(m.return_on_assets), sigDebtEquity(m.debt_to_equity)];
  const valuation: Signal[] = [sigPE(m.pe_ratio), sigFwdPE(m.forward_pe, m.pe_ratio), sigEvEbitda(m.enterprise_to_ebitda)];

  const cards = [
    { title: "PROFITABILITY", signals: profitability },
    { title: "GROWTH", signals: growth },
    { title: "QUALITY", signals: quality },
    { title: "VALUATION", signals: valuation },
  ];

  const overall = gradeFromSignals([...profitability, ...growth, ...quality, ...valuation]);

  return (
    <div className="p-4 flex flex-col gap-4 text-[12px]">
      <div className="panel">
        <div className="panel-header"><span>OVERALL GRADE</span></div>
        <div className="p-4 flex items-center gap-6">
          <div className={cn("text-5xl font-bold tracking-widest", gradeColor(overall.grade))}>{overall.grade}</div>
          <div className="sub-header leading-relaxed max-w-md">
            RULE-BASED COMPOSITE OF PROFITABILITY, GROWTH, QUALITY &amp; VALUATION SIGNALS BELOW · NOT INVESTMENT ADVICE
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => {
          const g = gradeFromSignals(c.signals);
          return (
            <div key={c.title} className="panel">
              <div className="panel-header">
                <span>{c.title}</span>
                <span className={cn("text-lg font-bold", gradeColor(g.grade))}>{g.grade}</span>
              </div>
              <div className="p-3 flex flex-col gap-2">
                {c.signals.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", levelDot(s.level))} />
                    <span className={cn("flex-1", s.level === "bull" && "up", s.level === "bear" && "down", s.level === "neutral" && "text-term-text", s.level === "na" && "text-term-muted")}>
                      {s.label}
                    </span>
                    {s.detail && <span className="num text-term-muted text-[11px]">{s.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
