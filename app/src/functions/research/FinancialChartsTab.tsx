import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchIncome, fetchDividends } from "@/lib/api";
import { fmtVolume, fmtPrice, fmtPct } from "@/lib/format";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle, BarTrend } from "./shared";

/** Charting only — same income/dividend query keys as FA/DVD, no new data source. */
export function FinancialChartsTab({ symbol }: { symbol: string }) {
  const incomeQ = useQuery({ queryKey: ["income", symbol], queryFn: () => fetchIncome(symbol) });
  const dvdQ = useQuery({ queryKey: ["dividends", symbol], queryFn: () => fetchDividends(symbol) });

  const income = useMemo(() => [...(incomeQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? 1 : -1)), [incomeQ.data]);
  const annualDvd = useMemo(() => {
    const byYear: Record<string, number> = {};
    for (const d of dvdQ.data ?? []) {
      const y = d.ex_dividend_date.slice(0, 4);
      byYear[y] = (byYear[y] ?? 0) + d.amount;
    }
    return Object.entries(byYear).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  }, [dvdQ.data]);

  if (incomeQ.isLoading) return <Loading />;
  if (incomeQ.error) return <ErrorBlock err={incomeQ.error as Error} />;
  if (income.length === 0) return <EmptyBlock>No financial history for {symbol}.</EmptyBlock>;

  const years = income.map((r) => r.period_ending.slice(0, 4));
  const revenue = income.map((r) => r.total_revenue ?? 0);
  const eps = income.map((r) => r.diluted_earnings_per_share ?? r.basic_earnings_per_share ?? 0);
  const grossMargin = income.map((r) => (r.total_revenue ? ((r.gross_profit ?? 0) / r.total_revenue) * 100 : 0));
  const opMargin = income.map((r) => (r.total_revenue ? ((r.operating_income ?? 0) / r.total_revenue) * 100 : 0));
  const netMargin = income.map((r) => (r.total_revenue ? ((r.net_income ?? 0) / r.total_revenue) * 100 : 0));

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-[12px]">
      <ChartCard title="REVENUE TREND">
        <BarTrend data={years.map((y, i) => ({ label: y, value: revenue[i] }))} fmt={fmtVolume} />
      </ChartCard>
      <ChartCard title="EPS TREND (DILUTED)">
        <BarTrend data={years.map((y, i) => ({ label: y, value: eps[i] }))} fmt={(v) => fmtPrice(v, 2)} />
      </ChartCard>
      <ChartCard title="MARGIN TREND (GROSS / OPERATING / NET)">
        <div className="flex flex-col gap-3">
          <MarginRow label="Gross" data={years.map((y, i) => ({ label: y, value: grossMargin[i] }))} />
          <MarginRow label="Operating" data={years.map((y, i) => ({ label: y, value: opMargin[i] }))} />
          <MarginRow label="Net" data={years.map((y, i) => ({ label: y, value: netMargin[i] }))} />
        </div>
      </ChartCard>
      <ChartCard title="ANNUAL DIVIDEND / SHARE">
        {annualDvd.length === 0
          ? <EmptyBlock>No dividend history.</EmptyBlock>
          : <BarTrend data={annualDvd.map(([y, v]) => ({ label: y, value: v }))} fmt={(v) => fmtPrice(v, 4)} />}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-header"><span>{title}</span></div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function MarginRow({ label, data }: { label: string; data: { label: string; value: number }[] }) {
  return (
    <div>
      <div className="sub-header mb-1">{label.toUpperCase()} MARGIN</div>
      <BarTrend data={data} fmt={(v) => fmtPct(v, 1)} height={40} />
    </div>
  );
}
