import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEarningsCalendar, fetchIncome, fetchConsensus } from "@/lib/api";
import { fmtPrice, fmtVolume, fmtDate } from "@/lib/format";
import { Loading, ErrorBlock, SectionTitle, BarTrend } from "./shared";

const WINDOW_DAYS = 45;

/** Next confirmed report date (free nasdaq calendar, same fetcher News Hub's
 * Earnings panel uses — just windowed forward and filtered to one symbol)
 * plus the realized-EPS trend already pulled by FA. No new data source. */
export function EarningsTab({ symbol }: { symbol: string }) {
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + WINDOW_DAYS * 864e5).toISOString().slice(0, 10);

  const calQ = useQuery({
    queryKey: ["earnings-calendar", start, end],
    queryFn: () => fetchEarningsCalendar(start, end),
    staleTime: 5 * 60_000,
  });
  const incomeQ = useQuery({ queryKey: ["income", symbol], queryFn: () => fetchIncome(symbol) });
  const consensusQ = useQuery({ queryKey: ["consensus", symbol], queryFn: () => fetchConsensus(symbol) });

  const next = useMemo(() => (calQ.data ?? []).find((r) => r.symbol === symbol), [calQ.data, symbol]);
  const income = useMemo(() => [...(incomeQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? 1 : -1)), [incomeQ.data]);
  const e = consensusQ.data;

  if (incomeQ.isLoading) return <Loading />;
  if (incomeQ.error) return <ErrorBlock err={incomeQ.error as Error} />;

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px]">
      <div>
        <SectionTitle>NEXT EARNINGS</SectionTitle>
        {calQ.isLoading ? (
          <div className="text-term-muted">Checking calendar…</div>
        ) : next ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 max-w-2xl">
            <KV k="REPORT DATE" v={<span className="text-term-amber">{fmtDate(next.report_date)}</span>} />
            <KV k="TIMING" v={next.reporting_time === "pre-market" ? "BMO" : next.reporting_time === "after-hours" ? "AMC" : "—"} />
            <KV k="EPS CONSENSUS" v={next.eps_consensus != null ? fmtPrice(next.eps_consensus, 2) : "—"} />
            <KV k="EPS PRIOR YR" v={next.eps_previous != null ? fmtPrice(next.eps_previous, 2) : "—"} />
            <KV k="# ESTIMATES" v={next.num_estimates ?? "—"} />
            <KV k="ANALYSTS (CONSENSUS)" v={e?.number_of_analysts ?? "—"} />
          </div>
        ) : (
          <div className="text-term-muted">No confirmed report date in the next {WINDOW_DAYS} days for {symbol}.</div>
        )}
      </div>

      <div>
        <SectionTitle>HISTORICAL EPS (ANNUAL, REPORTED)</SectionTitle>
        {income.length === 0 ? (
          <div className="text-term-muted">No data.</div>
        ) : (
          <BarTrend
            data={income.map((r) => ({ label: r.period_ending.slice(0, 4), value: r.diluted_earnings_per_share ?? r.basic_earnings_per_share ?? 0 }))}
            fmt={(v) => fmtPrice(v, 2)}
          />
        )}
      </div>

      <div>
        <SectionTitle>NET INCOME TREND</SectionTitle>
        {income.length === 0 ? (
          <div className="text-term-muted">No data.</div>
        ) : (
          <BarTrend data={income.map((r) => ({ label: r.period_ending.slice(0, 4), value: r.net_income ?? 0 }))} fmt={fmtVolume} />
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <div className="sub-header py-0.5">{k}</div>
      <div className="num text-right py-0.5 text-term-text">{v}</div>
    </>
  );
}
