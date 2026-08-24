import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchIncome, fetchBalance, fetchCashFlow } from "@/lib/api";
import { fmtVolume, fmtPrice, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock } from "./shared";

type Statement = "income" | "balance" | "cashflow";

const INCOME_ROWS: { label: string; key: keyof import("@/lib/api").IncomeRow; money?: boolean; per?: boolean; highlight?: boolean }[] = [
  { label: "Total Revenue", key: "total_revenue", money: true },
  { label: "Cost of Revenue", key: "cost_of_revenue", money: true },
  { label: "Gross Profit", key: "gross_profit", money: true, highlight: true },
  { label: "R&D Expense", key: "research_and_development_expense", money: true },
  { label: "SG&A Expense", key: "selling_general_and_admin_expense", money: true },
  { label: "Operating Income", key: "operating_income", money: true, highlight: true },
  { label: "Pre-Tax Income", key: "total_pre_tax_income", money: true },
  { label: "Net Income", key: "net_income", money: true, highlight: true },
  { label: "EPS Diluted", key: "diluted_earnings_per_share", per: true },
];

const BALANCE_ROWS: { label: string; key: keyof import("@/lib/api").BalanceRow; highlight?: boolean }[] = [
  { label: "Cash & Equivalents", key: "cash_and_cash_equivalents" },
  { label: "Total Current Assets", key: "total_current_assets" },
  { label: "Total Assets", key: "total_assets", highlight: true },
  { label: "Current Liabilities", key: "current_liabilities" },
  { label: "Total Liabilities", key: "total_liabilities_net_minority_interest", highlight: true },
  { label: "Total Debt", key: "total_debt" },
  { label: "Net Debt", key: "net_debt" },
  { label: "Shareholder Equity", key: "total_common_equity", highlight: true },
  { label: "Working Capital", key: "working_capital" },
];

const CASHFLOW_ROWS: { label: string; key: keyof import("@/lib/api").CashFlowRow; highlight?: boolean }[] = [
  { label: "Operating Cash Flow", key: "operating_cash_flow", highlight: true },
  { label: "Capital Expenditure", key: "capital_expenditure" },
  { label: "Free Cash Flow", key: "free_cash_flow", highlight: true },
  { label: "Depreciation & Amortization", key: "depreciation_and_amortization" },
  { label: "Stock-Based Compensation", key: "stock_based_compensation" },
  { label: "Dividends Paid", key: "cash_dividends_paid" },
  { label: "Share Repurchases", key: "repurchase_of_common_equity" },
];

const TABS: { id: Statement; label: string }[] = [
  { id: "income", label: "Income Statement" },
  { id: "balance", label: "Balance Sheet" },
  { id: "cashflow", label: "Cash Flow" },
];

/** Full statements — Income reuses FA's exact table pattern (and query key,
 * so no refetch); Balance/Cash Flow are new free yfinance fetchers. */
export function FinancialsTab({ symbol }: { symbol: string }) {
  const [stmt, setStmt] = useState<Statement>("income");
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 h-8 border-b border-term-border text-[11px] uppercase tracking-wider shrink-0">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setStmt(t.id)}
            className={cn("px-2 py-0.5 border", stmt === t.id ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {stmt === "income" && <IncomeStatement symbol={symbol} />}
        {stmt === "balance" && <BalanceSheet symbol={symbol} />}
        {stmt === "cashflow" && <CashFlowStatement symbol={symbol} />}
      </div>
    </div>
  );
}

function IncomeStatement({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({ queryKey: ["income", symbol], queryFn: () => fetchIncome(symbol) });
  const sorted = [...data].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1));
  if (isLoading) return <Loading />;
  if (error) return <ErrorBlock err={error as Error} />;
  if (sorted.length === 0) return <EmptyBlock>No data.</EmptyBlock>;
  return (
    <StatementTable
      cols={sorted.map((r) => r.period_ending)}
      rows={INCOME_ROWS}
      data={sorted}
      fmtVal={(v, per) => (v == null ? "—" : per ? fmtPrice(v, 2) : fmtVolume(v))}
      source="YFINANCE VIA OPENBB · ANNUAL PERIODS"
    />
  );
}

function BalanceSheet({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({ queryKey: ["balance", symbol], queryFn: () => fetchBalance(symbol) });
  const sorted = [...data].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1));
  if (isLoading) return <Loading />;
  if (error) return <ErrorBlock err={error as Error} />;
  if (sorted.length === 0) return <EmptyBlock>No data.</EmptyBlock>;
  return (
    <StatementTable
      cols={sorted.map((r) => r.period_ending)}
      rows={BALANCE_ROWS}
      data={sorted}
      fmtVal={(v) => (v == null ? "—" : fmtVolume(v))}
      source="YFINANCE VIA OPENBB · ANNUAL PERIODS"
    />
  );
}

function CashFlowStatement({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({ queryKey: ["cashflow", symbol], queryFn: () => fetchCashFlow(symbol) });
  const sorted = [...data].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1));
  if (isLoading) return <Loading />;
  if (error) return <ErrorBlock err={error as Error} />;
  if (sorted.length === 0) return <EmptyBlock>No data.</EmptyBlock>;
  return (
    <StatementTable
      cols={sorted.map((r) => r.period_ending)}
      rows={CASHFLOW_ROWS}
      data={sorted}
      fmtVal={(v) => (v == null ? "—" : fmtVolume(v))}
      source="YFINANCE VIA OPENBB · ANNUAL PERIODS"
    />
  );
}

function StatementTable<T extends object>({
  cols, rows, data, fmtVal, source,
}: {
  cols: string[];
  rows: { label: string; key: keyof T; per?: boolean; highlight?: boolean }[];
  data: T[];
  fmtVal: (v: number | undefined, per?: boolean) => string;
  source: string;
}) {
  return (
    <div className="p-3 text-[12px]">
      <table className="w-full grid-data">
        <thead>
          <tr>
            <th>Line Item (USD)</th>
            {cols.map((c) => <th key={c} className="text-right">{fmtDate(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.key)}>
              <td className={cn(row.highlight && "text-term-amber")}>{row.label}</td>
              {data.map((r, i) => (
                <td key={cols[i]} className={cn("text-right num", row.highlight && "text-term-amber font-semibold")}>
                  {fmtVal(r[row.key] as number | undefined, row.per)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sub-header mt-3">SOURCE: {source}</div>
    </div>
  );
}
