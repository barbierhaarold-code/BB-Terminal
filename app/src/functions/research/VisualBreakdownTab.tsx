import { useQuery } from "@tanstack/react-query";
import { fetchIncome, fetchBalance } from "@/lib/api";
import { fmtVolume, fmtDate } from "@/lib/format";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle, Waterfall, ProportionBar, type WaterfallStep } from "./shared";

/** Revenue→net-income waterfall + balance-sheet composition. yfinance has no
 * free segment-level revenue breakdown, so per the spec this falls back to
 * the standard income statement FA already fetches (same query key, no
 * refetch) rather than reaching for a new provider. */
export function VisualBreakdownTab({ symbol }: { symbol: string }) {
  const incomeQ = useQuery({ queryKey: ["income", symbol], queryFn: () => fetchIncome(symbol) });
  const balanceQ = useQuery({ queryKey: ["balance", symbol], queryFn: () => fetchBalance(symbol) });

  if (incomeQ.isLoading || balanceQ.isLoading) return <Loading />;
  if (incomeQ.error) return <ErrorBlock err={incomeQ.error as Error} />;
  if (balanceQ.error) return <ErrorBlock err={balanceQ.error as Error} />;

  const income = [...(incomeQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1));
  const latestIncome = income[0];
  const balance = [...(balanceQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1));
  const latestBalance = balance[0];

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px]">
      <div>
        <SectionTitle>
          REVENUE → NET INCOME WATERFALL {latestIncome && <span className="normal-case font-normal text-term-muted">· FY {fmtDate(latestIncome.period_ending)}</span>}
        </SectionTitle>
        {!latestIncome ? <EmptyBlock>No income statement data.</EmptyBlock> : (
          <IncomeWaterfall row={latestIncome} />
        )}
      </div>

      <div>
        <SectionTitle>
          BALANCE SHEET COMPOSITION {latestBalance && <span className="normal-case font-normal text-term-muted">· FY {fmtDate(latestBalance.period_ending)}</span>}
        </SectionTitle>
        {!latestBalance ? <EmptyBlock>No balance sheet data.</EmptyBlock> : (
          <div className="flex flex-col gap-5 max-w-2xl">
            <div>
              <div className="sub-header mb-1.5">ASSETS COMPOSITION</div>
              <ProportionBar segments={[
                { label: "Current Assets", value: latestBalance.total_current_assets ?? 0, className: "bg-term-green/70" },
                { label: "Non-Current Assets", value: latestBalance.total_non_current_assets ?? 0, className: "bg-term-cyan/60" },
              ]} />
            </div>
            <div>
              <div className="sub-header mb-1.5">LIABILITIES + EQUITY COMPOSITION</div>
              <ProportionBar segments={[
                { label: "Current Liabilities", value: latestBalance.current_liabilities ?? 0, className: "bg-term-red/70" },
                { label: "Non-Current Liabilities", value: latestBalance.total_non_current_liabilities_net_minority_interest ?? 0, className: "bg-term-red/40" },
                { label: "Shareholder Equity", value: latestBalance.total_common_equity ?? latestBalance.common_stock_equity ?? 0, className: "bg-term-amber/70" },
              ]} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-term-border">
              <KV k="TOTAL ASSETS" v={fmtVolume(latestBalance.total_assets)} />
              <KV k="TOTAL LIABILITIES" v={fmtVolume(latestBalance.total_liabilities_net_minority_interest)} />
              <KV k="TOTAL EQUITY" v={fmtVolume(latestBalance.total_common_equity ?? latestBalance.common_stock_equity)} />
              <KV k="TOTAL DEBT" v={fmtVolume(latestBalance.total_debt)} />
              <KV k="CASH & EQUIVALENTS" v={fmtVolume(latestBalance.cash_and_cash_equivalents)} />
              <KV k="NET DEBT" v={fmtVolume(latestBalance.net_debt)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IncomeWaterfall({ row }: { row: import("@/lib/api").IncomeRow }) {
  const revenue = row.total_revenue ?? 0;
  const cogs = -(row.cost_of_revenue ?? 0);
  const rnd = -(row.research_and_development_expense ?? 0);
  const sga = -(row.selling_general_and_admin_expense ?? 0);
  const grossProfit = row.gross_profit ?? revenue + cogs;
  const opIncome = row.operating_income;
  const otherToOp = opIncome != null ? opIncome - (grossProfit + rnd + sga) : 0;
  const netIncome = row.net_income;
  const otherToNet = opIncome != null && netIncome != null ? netIncome - opIncome : undefined;

  const steps: WaterfallStep[] = [
    { label: "Revenue", value: revenue, kind: "start" },
    { label: "COGS", value: cogs, kind: "delta" },
    { label: "R&D", value: rnd, kind: "delta" },
    { label: "SG&A", value: sga, kind: "delta" },
  ];
  if (Math.abs(otherToOp) > 1) steps.push({ label: "Other Opex", value: otherToOp, kind: "delta" });
  if (opIncome != null) steps.push({ label: "Operating Income", value: opIncome, kind: "total" });
  if (otherToNet != null) steps.push({ label: "Tax + Other", value: otherToNet, kind: "delta" });
  if (netIncome != null) steps.push({ label: "Net Income", value: netIncome, kind: "total" });

  return <Waterfall steps={steps} fmt={fmtVolume} />;
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <div className="sub-header py-0.5">{k}</div>
      <div className="num text-right py-0.5 text-term-text">{v}</div>
    </>
  );
}
