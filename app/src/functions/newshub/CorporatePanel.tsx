import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ApiError, fetchDividendCalendar, fetchIpoCalendar, fetchStockSplits } from "@/lib/api";
import { fmtVolume } from "@/lib/format";
import { toYmd } from "@/lib/weekview";

function windowRange(offsetWindows: number, spanDays = 14) {
  const start = new Date();
  start.setDate(start.getDate() + offsetWindows * spanDays);
  const end = new Date(start);
  end.setDate(start.getDate() + spanDays - 1);
  return { start: toYmd(start), end: toYmd(end) };
}

function MiniTable({ title, children, rangeLabel }: { title: string; children: React.ReactNode; rangeLabel: string }) {
  return (
    <div className="panel min-h-0">
      <div className="panel-header">
        <span>{title}</span>
        <span className="normal-case tracking-normal font-normal text-term-muted">{rangeLabel}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">{children}</div>
    </div>
  );
}

function GapNotice({ note }: { note: string }) {
  return <div className="p-3 text-term-muted text-[11px] leading-relaxed">{note}</div>;
}

export function CorporatePanel() {
  const [offset, setOffset] = useState(0);
  const { start, end } = useMemo(() => windowRange(offset), [offset]);
  const rangeLabel = `${start} → ${end}`;

  const dividends = useQuery({
    queryKey: ["newshub-dividends", start, end],
    queryFn: () => fetchDividendCalendar(start, end),
    staleTime: 5 * 60_000,
  });
  const ipos = useQuery({
    queryKey: ["newshub-ipo", start, end],
    queryFn: () => fetchIpoCalendar(start, end),
    staleTime: 5 * 60_000,
  });
  const splits = useQuery({
    queryKey: ["newshub-splits", start, end],
    queryFn: () => fetchStockSplits(start, end),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 h-8 px-2 border-b border-term-border bg-term-panel2 text-[11px] shrink-0">
        <button onClick={() => setOffset((o) => o - 1)} className="text-term-muted hover:text-term-amber"><ChevronLeft size={14} /></button>
        <span className="uppercase tracking-widest text-[10px] text-term-muted">{rangeLabel} (14-day window)</span>
        <button onClick={() => setOffset((o) => o + 1)} className="text-term-muted hover:text-term-amber"><ChevronRight size={14} /></button>
        {offset !== 0 && (
          <button onClick={() => setOffset(0)} className="ml-2 text-term-amber uppercase tracking-widest text-[10px]">Today</button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin grid grid-cols-1 lg:grid-cols-2 gap-2 p-2">
        <MiniTable title="Dividends Calendar" rangeLabel={`${dividends.data?.length ?? 0} rows`}>
          {dividends.isLoading && <div className="p-3 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
          {dividends.error && <div className="p-3 text-term-red text-[11px]">{(dividends.error as Error).message}</div>}
          {!dividends.isLoading && !dividends.error && (dividends.data?.length ?? 0) === 0 && <div className="p-3 text-term-muted text-[11px]">No dividends in this window.</div>}
          {!dividends.isLoading && !dividends.error && (dividends.data?.length ?? 0) > 0 && (
            <table className="grid-data w-full text-[11px]">
              <thead><tr><th>Ex-Date</th><th>Symbol</th><th className="text-right">Amount</th><th className="text-right">Annualized</th></tr></thead>
              <tbody>
                {dividends.data!.slice(0, 100).map((d, i) => (
                  <tr key={d.symbol + d.ex_dividend_date + i}>
                    <td className="num text-term-muted">{d.ex_dividend_date}</td>
                    <td className="text-term-heading font-bold">{d.symbol}</td>
                    <td className="num text-right">${d.amount.toFixed(3)}</td>
                    <td className="num text-right text-term-muted">{d.annualized_amount ? "$" + d.annualized_amount.toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniTable>

        <MiniTable title="Dividend Changes" rangeLabel="gap">
          <GapNotice note='No free bulk "dividend increase/decrease" feed found in the installed OpenBB providers — nasdaq/fmp expose the raw dividends calendar (left panel) but not a diffed changes feed. Would need a per-symbol history scan against fundamental/dividends, which risks the yfinance rate-limit already documented in vite.config.ts for a market-wide sweep. Flagged as an open gap, not built.' />
        </MiniTable>

        <MiniTable title="IPO Calendar" rangeLabel={`${ipos.data?.length ?? 0} rows`}>
          {ipos.isLoading && <div className="p-3 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
          {ipos.error && <div className="p-3 text-term-red text-[11px]">{(ipos.error as Error).message}</div>}
          {!ipos.isLoading && !ipos.error && (ipos.data?.length ?? 0) === 0 && <div className="p-3 text-term-muted text-[11px]">No IPOs in this window.</div>}
          {!ipos.isLoading && !ipos.error && (ipos.data?.length ?? 0) > 0 && (
            <table className="grid-data w-full text-[11px]">
              <thead><tr><th>Date</th><th>Symbol</th><th>Name</th><th className="text-right">Offer</th><th>Status</th></tr></thead>
              <tbody>
                {ipos.data!.slice(0, 100).map((d, i) => (
                  <tr key={(d.symbol ?? d.name) + d.ipo_date + i}>
                    <td className="num text-term-muted">{d.ipo_date}</td>
                    <td className="text-term-heading font-bold">{d.symbol ?? "—"}</td>
                    <td className="text-term-muted truncate max-w-[160px]">{d.name}</td>
                    <td className="num text-right">{d.offer_amount ? fmtVolume(d.offer_amount) : "—"}</td>
                    <td className="text-term-muted">{d.deal_status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniTable>

        <MiniTable title="Stock Splits Calendar" rangeLabel={splits.error ? "needs key" : `${splits.data?.length ?? 0} rows`}>
          {splits.isLoading && <div className="p-3 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
          {splits.error && (
            <GapNotice
              note={
                splits.error instanceof ApiError && (splits.error.needsKey === "fmp_api_key" || /fmp_api_key/i.test(splits.error.message))
                  ? "OpenBB only exposes stock splits via the fmp provider, which needs a paid/free-tier fmp_api_key. FMP has a free tier (financialmodelingprep.com) — set OPENBB_FMP_API_KEY before starting openbb-api to light this up; no code change needed."
                  : (splits.error as Error).message
              }
            />
          )}
          {!splits.isLoading && !splits.error && (splits.data?.length ?? 0) === 0 && <div className="p-3 text-term-muted text-[11px]">No splits in this window.</div>}
          {!splits.isLoading && !splits.error && (splits.data?.length ?? 0) > 0 && (
            <table className="grid-data w-full text-[11px]">
              <thead><tr><th>Date</th><th>Symbol</th><th className="text-right">Ratio</th></tr></thead>
              <tbody>
                {splits.data!.slice(0, 100).map((d, i) => (
                  <tr key={d.symbol + d.date + i}>
                    <td className="num text-term-muted">{d.date}</td>
                    <td className="text-term-heading font-bold">{d.symbol}</td>
                    <td className="num text-right">{d.old_shares && d.new_shares ? `${d.new_shares}:${d.old_shares}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniTable>

        <MiniTable title="IPO Lock-up Expiry" rangeLabel="gap">
          <GapNotice note="No provider for this in the installed OpenBB Platform (checked fmp/intrinio/nasdaq's IPO endpoints — none carry lock-up expiry dates), and no free standalone API found either. This is a genuine coverage gap, not a build task deferred — would need a paid provider (e.g. Intrinio's IPO add-on) to close." />
        </MiniTable>
      </div>
    </div>
  );
}
