import { useQuery } from "@tanstack/react-query";
import { fetchMetrics } from "@/lib/api";
import { fmtPrice, fmtVolume, fmtPctFromDecimal } from "@/lib/format";
import { DataNote } from "./research/shared";

type Group = { title: string; rows: { label: string; val: React.ReactNode }[] };

export function KEY({ symbol }: { symbol: string }) {
  const { data: m, isLoading, error } = useQuery({
    queryKey: ["metrics", symbol], queryFn: () => fetchMetrics(symbol),
  });

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (!m) return <div className="p-4 text-term-muted">No metrics.</div>;

  const groups: Group[] = [
    {
      title: "Valuation",
      rows: [
        { label: "Market Cap", val: fmtVolume(m.market_cap) },
        { label: "Enterprise Value", val: fmtVolume(m.enterprise_value) },
        { label: "P/E (ttm)", val: m.pe_ratio?.toFixed(2) ?? "—" },
        { label: "P/E Forward", val: m.forward_pe?.toFixed(2) ?? "—" },
        { label: "PEG Ratio", val: m.peg_ratio?.toFixed(2) ?? "—" },
        { label: "EV / EBITDA", val: m.enterprise_to_ebitda?.toFixed(2) ?? "—" },
        { label: "Price / Book", val: m.price_to_book?.toFixed(2) ?? "—" },
        { label: "Book Value / Sh", val: fmtPrice(m.book_value) },
      ],
    },
    {
      title: "Growth",
      rows: [
        { label: "Revenue Growth", val: fmtPctFromDecimal(m.revenue_growth) },
        { label: "Earnings Growth", val: fmtPctFromDecimal(m.earnings_growth) },
      ],
    },
    {
      title: "Profitability",
      rows: [
        { label: "Gross Margin", val: fmtPctFromDecimal(m.gross_margin) },
        { label: "Operating Margin", val: fmtPctFromDecimal(m.operating_margin) },
        { label: "Profit Margin", val: fmtPctFromDecimal(m.profit_margin) },
        { label: "Return on Assets", val: fmtPctFromDecimal(m.return_on_assets) },
        { label: "Return on Equity", val: fmtPctFromDecimal(m.return_on_equity) },
      ],
    },
    {
      title: "Balance Sheet",
      rows: [
        { label: "Current Ratio", val: m.current_ratio?.toFixed(2) ?? "—" },
        { label: "Quick Ratio", val: m.quick_ratio?.toFixed(2) ?? "—" },
        { label: "Debt / Equity", val: m.debt_to_equity?.toFixed(2) ?? "—" },
      ],
    },
    {
      title: "Dividend",
      rows: [
        { label: "Div Yield", val: fmtPctFromDecimal(m.dividend_yield) },
        { label: "Payout Ratio", val: fmtPctFromDecimal(m.payout_ratio) },
      ],
    },
  ];

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-[12px]">
      <div className="col-span-full"><DataNote>Key ratios grouped by what they measure: valuation (price vs. earnings, sales, book value), profitability (margins, returns), leverage (debt) and efficiency. Useful for comparing a company with its peers or its own history. Ratios are computed from reported financials, so they reflect the past, and definitions differ slightly between data providers.</DataNote></div>
      {groups.map((g) => (
        <div key={g.title}>
          <div className="text-term-amber text-[10px] tracking-[0.25em] font-bold border-b border-term-border pb-1 mb-2">{g.title.toUpperCase()}</div>
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {g.rows.map((r) => (
              <div key={r.label} className="contents">
                <div className="sub-header py-0.5 normal-case tracking-wide text-term-muted">{r.label}</div>
                <div className="num text-right py-0.5 text-term-text">{r.val}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
