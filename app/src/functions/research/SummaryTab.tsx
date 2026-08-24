import { useQueries } from "@tanstack/react-query";
import { fetchQuote, fetchProfile, fetchMetrics, fetchConsensus, fetchNewsCompany } from "@/lib/api";
import { fmtPrice, fmtVolume, fmtTime, fmtPctFromDecimal } from "@/lib/format";
import { useWorkspace } from "@/store/workspaceStore";
import { Loading, SectionTitle } from "./shared";

/** Landing overview — reuses the exact same query keys as INTEL/DES/EE, so
 * opening RESEARCH after any of those tabs costs zero extra fetches. */
export function SummaryTab({ symbol }: { symbol: string }) {
  const openTab = useWorkspace((s) => s.openTab);
  const [quoteQ, profileQ, metricsQ, consensusQ, newsQ] = useQueries({
    queries: [
      { queryKey: ["quote", symbol], queryFn: () => fetchQuote(symbol), refetchInterval: 5000 },
      { queryKey: ["profile", symbol], queryFn: () => fetchProfile(symbol) },
      { queryKey: ["metrics", symbol], queryFn: () => fetchMetrics(symbol) },
      { queryKey: ["consensus", symbol], queryFn: () => fetchConsensus(symbol) },
      { queryKey: ["news", symbol], queryFn: () => fetchNewsCompany(symbol, 6) },
    ],
  });
  const p = profileQ.data, m = metricsQ.data, e = consensusQ.data, q = quoteQ.data;
  const news = newsQ.data ?? [];

  if (profileQ.isLoading || metricsQ.isLoading) return <Loading />;

  return (
    <div className="p-4 grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] text-[12px]">
      <div className="flex flex-col gap-4">
        <div className="panel">
          <div className="panel-header"><span>BUSINESS</span></div>
          <div className="p-3 text-term-text leading-relaxed max-h-[220px] overflow-auto scroll-thin">
            {p?.long_description ?? "No description available."}
          </div>
        </div>
        <div className="panel min-h-0 flex-1">
          <div className="panel-header"><span>LATEST HEADLINES</span></div>
          <div className="flex-1 overflow-auto scroll-thin divide-y divide-term-borderSoft">
            {news.slice(0, 6).map((n, i) => (
              <a key={n.id + i} href={n.url} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-term-amberSubtle group">
                <div className="sub-header">{fmtTime(n.date)} · {n.source}</div>
                <div className="text-term-heading group-hover:text-term-amber mt-0.5 leading-snug">{n.title}</div>
              </a>
            ))}
            {news.length === 0 && <div className="p-3 text-term-muted">No news.</div>}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <SectionTitle>KEY HIGHLIGHTS</SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <KV k="MKT CAP" v={fmtVolume(m?.market_cap ?? p?.market_cap)} />
            <KV k="P/E (TTM)" v={m?.pe_ratio?.toFixed(2) ?? "—"} />
            <KV k="FWD P/E" v={m?.forward_pe?.toFixed(2) ?? "—"} />
            <KV k="EV/EBITDA" v={m?.enterprise_to_ebitda?.toFixed(2) ?? "—"} />
            <KV k="REV GROWTH" v={fmtPctFromDecimal(m?.revenue_growth)} />
            <KV k="OP MARGIN" v={fmtPctFromDecimal(m?.operating_margin)} />
            <KV k="ROE" v={fmtPctFromDecimal(m?.return_on_equity)} />
            <KV k="DEBT/EQUITY" v={m?.debt_to_equity?.toFixed(2) ?? "—"} />
            <KV k="DIV YIELD" v={fmtPctFromDecimal(m?.dividend_yield)} />
            <KV k="BETA" v={p?.beta != null ? p.beta.toFixed(2) : "—"} />
          </div>
        </div>

        <div>
          <SectionTitle>ANALYST CONSENSUS</SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <KV k="RECOMMENDATION" v={<span className="text-term-amber">{e?.recommendation ?? "—"}</span>} />
            <KV k="ANALYSTS" v={e?.number_of_analysts ?? "—"} />
            <KV k="TARGET" v={<span className="text-term-amber">{fmtPrice(e?.target_consensus ?? undefined)}</span>} />
            <KV k="CURRENT" v={fmtPrice(e?.current_price ?? q?.last_price)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-term-border pt-3 text-[11px]">
          <span className="sub-header">JUMP TO:</span>
          {[
            { c: "INTEL", label: "Signal Scorecard" }, { c: "GP", label: "Chart" },
            { c: "OMON", label: "Options" }, { c: "NI", label: "All News" },
          ].map((x) => (
            <button key={x.c} onClick={() => openTab(x.c as never, symbol)}
              className="px-2 py-0.5 border border-term-border hover:border-term-amber hover:text-term-amber text-term-muted tracking-wider">
              {x.c} <span className="text-term-muted normal-case">· {x.label}</span>
            </button>
          ))}
        </div>
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
