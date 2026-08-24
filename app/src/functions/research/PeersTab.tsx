import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchPeers, fetchMetrics, fetchQuotes, type Metrics } from "@/lib/api";
import { fmtPrice, fmtVolume, fmtPctFromDecimal } from "@/lib/format";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle } from "./shared";

interface RatioRow { label: string; get: (m?: Metrics) => string; }

// Same rows KEY shows, one column per peer — reusing its ratio logic rather
// than re-deriving it.
const ROWS: RatioRow[] = [
  { label: "P/E (ttm)", get: (m) => m?.pe_ratio?.toFixed(2) ?? "—" },
  { label: "P/E Forward", get: (m) => m?.forward_pe?.toFixed(2) ?? "—" },
  { label: "EV/EBITDA", get: (m) => m?.enterprise_to_ebitda?.toFixed(2) ?? "—" },
  { label: "Price/Book", get: (m) => m?.price_to_book?.toFixed(2) ?? "—" },
  { label: "Revenue Growth", get: (m) => fmtPctFromDecimal(m?.revenue_growth) },
  { label: "Gross Margin", get: (m) => fmtPctFromDecimal(m?.gross_margin) },
  { label: "Operating Margin", get: (m) => fmtPctFromDecimal(m?.operating_margin) },
  { label: "Return on Equity", get: (m) => fmtPctFromDecimal(m?.return_on_equity) },
  { label: "Debt/Equity", get: (m) => m?.debt_to_equity?.toFixed(2) ?? "—" },
  { label: "Dividend Yield", get: (m) => fmtPctFromDecimal(m?.dividend_yield) },
];

/** Auto-derived peer list (free fmp compare/peers) + a side-by-side ratio
 * table built from KEY's existing rows, fanned out across peers. */
export function PeersTab({ symbol }: { symbol: string }) {
  const openTab = useWorkspace((s) => s.openTab);
  const peersQ = useQuery({ queryKey: ["peers", symbol], queryFn: () => fetchPeers(symbol) });
  const peerSymbols = useMemo(() => (peersQ.data ?? []).slice(0, 8).map((p) => p.symbol), [peersQ.data]);
  const symbols = useMemo(() => [symbol, ...peerSymbols], [symbol, peerSymbols]);

  const metricsQs = useQueries({
    queries: symbols.map((s) => ({ queryKey: ["metrics", s], queryFn: () => fetchMetrics(s), enabled: symbols.length > 0 })),
  });
  const quotesQ = useQuery({
    queryKey: ["peers-quotes", symbols.join(",")],
    queryFn: () => fetchQuotes(symbols),
    enabled: symbols.length > 0,
  });

  if (peersQ.isLoading) return <Loading />;
  if (peersQ.error) return <ErrorBlock err={peersQ.error as Error} />;
  if (peerSymbols.length === 0) return <EmptyBlock>No peer list available for {symbol}.</EmptyBlock>;

  const quoteBySymbol = new Map((quotesQ.data ?? []).map((q) => [q.symbol, q]));
  const metricsBySymbol = new Map(symbols.map((s, i) => [s, metricsQs[i].data]));

  return (
    <div className="p-4 flex flex-col gap-4 text-[12px]">
      <SectionTitle>PEER COMPARISON — {symbol} vs. {peerSymbols.length} SAME-SECTOR PEERS</SectionTitle>
      <div className="border border-term-border overflow-auto scroll-thin">
        <table className="w-full grid-data">
          <thead>
            <tr>
              <th>Metric</th>
              {symbols.map((s) => (
                <th key={s} className={cn("text-right", s === symbol && "text-term-amber")}>
                  <button onClick={() => openTab("RESEARCH", s)} className="hover:underline">{s}</button>
                </th>
              ))}
            </tr>
            <tr>
              <td className="text-term-muted">Price</td>
              {symbols.map((s) => <td key={s} className="num text-right">{fmtPrice(quoteBySymbol.get(s)?.last_price)}</td>)}
            </tr>
            <tr>
              <td className="text-term-muted">Market Cap</td>
              {symbols.map((s) => <td key={s} className="num text-right">{fmtVolume(metricsBySymbol.get(s)?.market_cap)}</td>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {symbols.map((s) => (
                  <td key={s} className={cn("num text-right", s === symbol && "text-term-amber font-semibold")}>
                    {row.get(metricsBySymbol.get(s))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sub-header">SOURCE: PEERS VIA FMP · RATIOS VIA YFINANCE — CLICK A SYMBOL TO OPEN ITS RESEARCH WORKSPACE</div>
    </div>
  );
}
