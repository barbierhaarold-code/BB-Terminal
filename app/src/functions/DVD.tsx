import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDividends } from "@/lib/api";
import { fmtPrice, fmtDate } from "@/lib/format";
import { DataNote } from "./research/shared";

export function DVD({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["dividends", symbol], queryFn: () => fetchDividends(symbol),
  });

  const sorted = useMemo(() => [...data].sort((a, b) => (a.ex_dividend_date > b.ex_dividend_date ? -1 : 1)), [data]);
  const annual = useMemo(() => {
    const byYear: Record<string, number> = {};
    for (const d of sorted) {
      const y = d.ex_dividend_date.slice(0, 4);
      byYear[y] = (byYear[y] ?? 0) + d.amount;
    }
    return Object.entries(byYear).sort((a, b) => (a[0] > b[0] ? -1 : 1));
  }, [sorted]);

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (sorted.length === 0) return <div className="p-4 text-term-muted">No dividend history.</div>;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 p-3 text-[12px] h-full content-start">
      <div className="col-span-2"><DataNote>The history of dividends the company has paid per share. Useful to see whether payments are steady, growing or have been cut. Past dividends do not guarantee future ones; check payout versus earnings.</DataNote></div>
      <div className="flex flex-col min-h-0">
        <div className="sub-header mb-1">PAYMENTS ({sorted.length})</div>
        <div className="flex-1 overflow-auto scroll-thin border border-term-border">
          <table className="w-full grid-data">
            <thead>
              <tr><th>Ex-Date</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={d.ex_dividend_date + i}>
                  <td className="num">{fmtDate(d.ex_dividend_date)}</td>
                  <td className="num text-right text-term-amber">{fmtPrice(d.amount, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-col min-h-0">
        <div className="sub-header mb-1">ANNUAL TOTALS</div>
        <div className="flex-1 overflow-auto scroll-thin border border-term-border">
          <table className="w-full grid-data">
            <thead>
              <tr><th>Year</th><th className="text-right">Total / Sh</th></tr>
            </thead>
            <tbody>
              {annual.map(([y, v]) => (
                <tr key={y}>
                  <td className="num">{y}</td>
                  <td className="num text-right text-term-heading">{fmtPrice(v, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
