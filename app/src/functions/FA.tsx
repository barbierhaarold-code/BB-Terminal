import { useQuery } from "@tanstack/react-query";
import { fetchIncome } from "@/lib/api";
import { fmtVolume, fmtPrice, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DataNote } from "./research/shared";

interface Row { label: string; key: keyof import("@/lib/api").IncomeRow; money?: boolean; per?: boolean; }
const ROWS: Row[] = [
  { label: "Total Revenue", key: "total_revenue", money: true },
  { label: "Cost of Revenue", key: "cost_of_revenue", money: true },
  { label: "Gross Profit", key: "gross_profit", money: true },
  { label: "R&D Expense", key: "research_and_development_expense", money: true },
  { label: "SG&A Expense", key: "selling_general_and_admin_expense", money: true },
  { label: "Operating Income", key: "operating_income", money: true },
  { label: "Pre-Tax Income", key: "total_pre_tax_income", money: true },
  { label: "Net Income", key: "net_income", money: true },
  { label: "EPS Basic", key: "basic_earnings_per_share", per: true },
  { label: "EPS Diluted", key: "diluted_earnings_per_share", per: true },
];

export function FA({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["income", symbol], queryFn: () => fetchIncome(symbol),
  });
  const sorted = [...data].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1));

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (sorted.length === 0) return <div className="p-4 text-term-muted text-[11px] uppercase tracking-widest">No data.</div>;

  return (
    <div className="p-3 text-[12px] flex flex-col gap-3">
      <DataNote>Income statement by year: revenue, costs and profit as reported. Useful to see whether sales and profits are growing and how margins change. Figures are as reported by the company via Yahoo Finance and can be restated.</DataNote>
      <table className="w-full grid-data">
        <thead>
          <tr>
            <th>Line Item (USD)</th>
            {sorted.map((r) => <th key={r.period_ending} className="text-right">{fmtDate(r.period_ending)}</th>)}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => {
            const isHighlight = ["Gross Profit", "Operating Income", "Net Income"].includes(row.label);
            return (
              <tr key={row.key}>
                <td className={cn(isHighlight && "text-term-amber")}>{row.label}</td>
                {sorted.map((r) => {
                  const v = r[row.key] as number | undefined;
                  return (
                    <td key={r.period_ending} className={cn("text-right num", isHighlight && "text-term-amber font-semibold")}>
                      {v == null ? "—" : row.per ? fmtPrice(v, 2) : fmtVolume(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sub-header mt-3">SOURCE: YFINANCE VIA OPENBB · ANNUAL PERIODS</div>
    </div>
  );
}
