import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCongressTrades } from "@/lib/api";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle, GapNotice } from "@/functions/research/shared";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

type ChamberFilter = "all" | "House" | "Senate";

/**
 * Congressional trading disclosures under the STOCK Act. FMP's
 * government_trades endpoint is restricted on this app's free tier and
 * Quiver Quantitative's API needs a paid plan — this runs on CongressInvests
 * (congressinvests.com), a free no-key aggregator of the same House/Senate
 * PTR filings, proxied server-side for response caching (see
 * lib/api.ts::fetchCongressTrades).
 */
export function CongressPanel() {
  const [chamber, setChamber] = useState<ChamberFilter>("all");
  const [query, setQuery] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["invest-congress"],
    queryFn: fetchCongressTrades,
    staleTime: 15 * 60_000,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase();
    return data
      .filter((t) => chamber === "all" || t.chamber === chamber)
      .filter((t) => !q || t.ticker?.toUpperCase().includes(q) || t.member?.toUpperCase().includes(q))
      .sort((a, b) => (a.tx_date > b.tx_date ? -1 : 1));
  }, [data, chamber, query]);

  return (
    <div className="p-4 flex flex-col gap-3 text-[12px]">
      <SectionTitle>CONGRESSIONAL TRADING — STOCK ACT DISCLOSURES</SectionTitle>
      <GapNotice>
        Sourced from CongressInvests, a free community aggregator of official House/Senate Periodic Transaction Report
        filings — not the SEC or a paid Quiver Quantitative feed. Amounts are the disclosed dollar range, not an exact figure
        (the STOCK Act itself only requires a range).
      </GapNotice>

      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "House", "Senate"] as ChamberFilter[]).map((c) => (
          <button
            key={c}
            onClick={() => setChamber(c)}
            className={cn(
              "px-2 py-0.5 border text-[11px] uppercase",
              chamber === c ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text"
            )}
          >
            {c}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="FILTER BY TICKER OR NAME"
          className="bg-term-panel2 border border-term-border px-2 py-1 text-[11px] uppercase w-56 outline-none focus:border-term-amber"
        />
      </div>

      {isLoading ? <Loading /> : error ? <ErrorBlock err={error as Error} /> : rows.length === 0 ? (
        <EmptyBlock>No matching disclosures.</EmptyBlock>
      ) : (
        <div className="border border-term-border overflow-auto scroll-thin max-h-[65vh]">
          <table className="w-full grid-data">
            <thead>
              <tr>
                <th>Tx Date</th><th>Disclosed</th><th>Member</th><th>Chamber</th>
                <th>Ticker</th><th>Type</th><th>Amount</th><th>Filing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const sale = t.trade_type?.toLowerCase() === "sell" || t.trade_type?.toLowerCase() === "sale";
                return (
                  <tr key={i}>
                    <td className="num">{fmtDate(t.tx_date)}</td>
                    <td className="num text-term-muted">{fmtDate(t.disclosed)}</td>
                    <td>{t.member}</td>
                    <td className="text-term-muted">{t.chamber}</td>
                    <td className="text-term-amberBright">{t.ticker || "—"}</td>
                    <td className={cn(sale ? "down" : "up")}>{t.trade_type}</td>
                    <td className="num text-right">{t.amount}</td>
                    <td>
                      {t.link ? (
                        <a href={t.link} target="_blank" rel="noreferrer" className="text-term-cyan hover:underline">
                          PDF
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
