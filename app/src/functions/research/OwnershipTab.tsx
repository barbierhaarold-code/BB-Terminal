import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchShareStatistics, fetchInsiderTrading } from "@/lib/api";
import { fmtVolume, fmtPrice, fmtDate, fmtPctFromDecimal } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock, GapNotice, SectionTitle, ProportionBar } from "./shared";

/** Ownership % (insider/institution/public) is free via yfinance's
 * share_statistics; insider transactions are free via SEC Form 4. A true
 * top-25-shareholders table needs FMP's major_holders/institutional
 * endpoints, which are restricted on the free tier this app is configured
 * with (verified live — 402 "Restricted Endpoint") — flagged below rather
 * than faked. */
export function OwnershipTab({ symbol }: { symbol: string }) {
  const statsQ = useQuery({ queryKey: ["share-stats", symbol], queryFn: () => fetchShareStatistics(symbol) });
  const insiderQ = useQuery({ queryKey: ["insider-trading", symbol], queryFn: () => fetchInsiderTrading(symbol, 50) });

  const s = statsQ.data;
  const insiders = insiderQ.data ?? [];
  const recentVolume = useMemo(
    () => insiders.reduce((a, t) => a + (t.securities_transacted ?? 0), 0),
    [insiders]
  );

  if (statsQ.isLoading) return <Loading />;
  if (statsQ.error) return <ErrorBlock err={statsQ.error as Error} />;
  if (!s) return <EmptyBlock>No ownership data for {symbol}.</EmptyBlock>;

  const insiderPct = s.insider_ownership ?? 0;
  const institutionPct = s.institution_ownership ?? 0;
  const publicPct = Math.max(0, 1 - insiderPct - institutionPct);

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px]">
      <div>
        <SectionTitle>OWNERSHIP BREAKDOWN</SectionTitle>
        <div className="max-w-xl">
          <ProportionBar segments={[
            { label: "Institutional", value: institutionPct, className: "bg-term-cyan/70" },
            { label: "Insider", value: insiderPct, className: "bg-term-amber/70" },
            { label: "Public / Other", value: publicPct, className: "bg-term-border" },
          ]} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-3 max-w-2xl">
          <KV k="INSTITUTIONS TRACKED" v={s.institutions_count ?? "—"} />
          <KV k="FLOAT SHARES" v={fmtVolume(s.float_shares)} />
          <KV k="OUTSTANDING SHARES" v={fmtVolume(s.outstanding_shares)} />
          <KV k="SHORT % OF FLOAT" v={fmtPctFromDecimal(s.short_percent_of_float)} />
          <KV k="SHORT INTEREST" v={fmtVolume(s.short_interest)} />
          <KV k="DAYS TO COVER" v={s.days_to_cover?.toFixed(2) ?? "—"} />
        </div>
      </div>

      <GapNotice>
        Top-25 shareholders (13F institutional holder names/positions) needs FMP's <code>major_holders</code> /
        <code> institutional</code> endpoints — restricted on this app's free FMP tier. Upgrading the FMP plan at
        financialmodelingprep.com would light this up; the ownership % above and insider transactions below are real
        data, no key required.
      </GapNotice>

      <div>
        <SectionTitle>INSIDER TRANSACTIONS (RECENT FORM 4s)</SectionTitle>
        <div className="sub-header mb-2">TOTAL SHARES TRANSACTED (SHOWN BELOW): <span className="text-term-text">{fmtVolume(recentVolume)}</span></div>
        {insiderQ.isLoading ? <Loading /> : insiderQ.error ? <ErrorBlock err={insiderQ.error as Error} /> : insiders.length === 0 ? (
          <EmptyBlock>No recent insider transactions.</EmptyBlock>
        ) : (
          <div className="border border-term-border max-h-[400px] overflow-auto scroll-thin">
            <table className="w-full grid-data">
              <thead>
                <tr>
                  <th>Filed</th><th>Insider</th><th>Title</th><th>Type</th>
                  <th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Owned After</th>
                </tr>
              </thead>
              <tbody>
                {insiders.map((t, i) => {
                  const disposal = t.acquisition_or_disposition === "Disposition";
                  return (
                    <tr key={i}>
                      <td className="num">{fmtDate(t.filing_date)}</td>
                      <td>{t.owner_name ?? "—"}</td>
                      <td className="text-term-muted">{t.owner_title ?? "—"}</td>
                      <td className={cn(disposal ? "down" : "up")}>{disposal ? "Sale" : "Buy"}</td>
                      <td className={cn("num text-right", disposal ? "down" : "up")}>{fmtVolume(t.securities_transacted)}</td>
                      <td className="num text-right">{fmtPrice(t.transaction_price)}</td>
                      <td className="num text-right text-term-muted">{fmtVolume(t.securities_owned)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
