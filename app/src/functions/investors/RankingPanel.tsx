import { useMemo, useState } from "react";
import { useAllFundHoldings, holdersOf } from "./fundsData";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle } from "@/functions/research/shared";
import { fmtVolume, fmtDate, fmtPctFromDecimal } from "@/lib/format";
import { UNIVERSE } from "@/lib/universe";
import { useWorkspace } from "@/store/workspaceStore";

/**
 * "Who holds ticker X" — same 13F data as the Funds tab, sliced by holder
 * instead of by fund (per the phase spec: reuse the Funds tab's data layer).
 * Scoped to the same curated fund universe, so a ticker with no free-tier
 * institutional footprint just shows an empty result, not an error.
 */
export function RankingPanel() {
  const activeSymbol = useWorkspace((s) => s.activeSymbol);
  const [symbol, setSymbol] = useState(activeSymbol ?? "AAPL");
  const [query, setQuery] = useState(symbol);
  const { data, isLoading, error } = useAllFundHoldings();

  const rows = useMemo(() => (data ? holdersOf(data, symbol) : []), [data, symbol]);
  const known = UNIVERSE.some((c) => c.symbol === symbol.toUpperCase());

  return (
    <div className="p-4 flex flex-col gap-3 text-[12px]">
      <SectionTitle>WHO HOLDS A TICKER — 13F PORTFOLIOS</SectionTitle>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); setSymbol(query.trim().toUpperCase()); }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          list="investors-ranking-symbols"
          placeholder="TICKER (e.g. AAPL)"
          className="bg-term-panel2 border border-term-border px-2 py-1 text-[12px] uppercase w-48 outline-none focus:border-term-amber"
        />
        <datalist id="investors-ranking-symbols">
          {UNIVERSE.map((c) => <option key={c.symbol} value={c.symbol}>{c.name}</option>)}
        </datalist>
        <button type="submit" className="border border-term-border px-3 py-1 text-[11px] uppercase hover:border-term-amber hover:text-term-amber">
          Go
        </button>
      </form>

      {!known ? (
        <EmptyBlock>"{symbol}" isn't in the tracked S&amp;P 500 / Nasdaq 100 / Dow 30 universe.</EmptyBlock>
      ) : isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBlock err={error as Error} />
      ) : rows.length === 0 ? (
        <EmptyBlock>None of the tracked funds report a {symbol} position in their latest 13F.</EmptyBlock>
      ) : (
        <div className="border border-term-border overflow-auto scroll-thin">
          <table className="w-full grid-data">
            <thead>
              <tr>
                <th>Rank</th><th>Fund</th>
                <th className="text-right">Position Value</th>
                <th className="text-right">Shares</th>
                <th className="text-right">% of Fund</th>
                <th>As Of</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.fund.cik}>
                  <td className="num">{i + 1}</td>
                  <td>{r.fund.name}</td>
                  <td className="num text-right">${fmtVolume(r.value)}</td>
                  <td className="num text-right">{fmtVolume(r.sharesHeld)}</td>
                  <td className="num text-right">{fmtPctFromDecimal(r.weight)}</td>
                  <td className="text-term-muted">{fmtDate(r.asOf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
