import { useQuery } from "@tanstack/react-query";
import { fetchProfile, fetchQuote } from "@/lib/api";
import { fmtPrice, fmtPct, fmtInt, fmtVolume } from "@/lib/format";

export function DES({ symbol }: { symbol: string }) {
  const profile = useQuery({ queryKey: ["profile", symbol], queryFn: () => fetchProfile(symbol) });
  const quote = useQuery({ queryKey: ["quote", symbol], queryFn: () => fetchQuote(symbol), refetchInterval: 5000 });

  const p = profile.data;
  const q = quote.data;
  const chg = q?.last_price != null && q?.prev_close != null ? q.last_price - q.prev_close : undefined;
  const chgPct = q?.last_price != null && q?.prev_close != null ? ((q.last_price - q.prev_close) / q.prev_close) * 100 : undefined;

  if (profile.isLoading) return <Loading />;
  if (profile.error) return <ErrorBlock err={profile.error as Error} />;

  return (
    <div className="p-4 grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-term-amber text-[11px] tracking-[0.22em]">NAME</div>
          <div className="text-[18px] text-term-heading">{p?.name ?? symbol}</div>
          <div className="sub-header mt-0.5">
            {p?.stock_exchange ?? "—"} · {p?.sector ?? "—"} · {p?.industry_category ?? "—"}
          </div>
        </div>

        <div className="flex items-baseline gap-4 border-t border-term-border pt-3">
          <div>
            <div className="sub-header">LAST</div>
            <div className="text-2xl num text-term-heading">{fmtPrice(q?.last_price)}</div>
          </div>
          <div className={chg == null ? "text-term-muted" : chg >= 0 ? "up" : "down"}>
            <div className="sub-header">CHG</div>
            <div className="text-lg num">{chg == null ? "—" : (chg >= 0 ? "+" : "") + fmtPrice(chg)} <span className="text-[13px]">({fmtPct(chgPct)})</span></div>
          </div>
          <div className="ml-auto text-right">
            <div className="sub-header">CURRENCY</div>
            <div className="num">{p?.currency ?? q?.currency ?? "—"}</div>
          </div>
        </div>

        <div className="border-t border-term-border pt-3">
          <div className="sub-header mb-1">BUSINESS</div>
          <div className="text-term-text text-[12px] leading-relaxed">
            {p?.long_description ?? "No description available."}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 content-start border-l border-term-border pl-4">
        <KV k="ISSUE TYPE" v={p?.issue_type ?? "—"} />
        <KV k="EMPLOYEES" v={fmtInt(p?.employees)} />
        <KV k="MARKET CAP" v={fmtVolume(p?.market_cap)} />
        <KV k="SHARES OUT" v={fmtVolume(p?.shares_outstanding)} />
        <KV k="SHARES FLOAT" v={fmtVolume(p?.shares_float)} />
        <KV k="BETA" v={p?.beta != null ? p.beta.toFixed(2) : "—"} />
        {/* /equity/profile's dividend_yield is already a percent (0.35 = 0.35%),
            unlike /equity/fundamental/metrics' decimal-fraction convention —
            fmtPctFromDecimal here was double-converting into "+35.00%". */}
        <KV k="DIV YIELD" v={fmtPct(p?.dividend_yield)} />
        <KV k="52W HIGH" v={fmtPrice(q?.year_high)} />
        <KV k="52W LOW" v={fmtPrice(q?.year_low)} />
        <KV k="MA 50D" v={fmtPrice(q?.ma_50d)} />
        <KV k="MA 200D" v={fmtPrice(q?.ma_200d)} />
        <KV k="AVG VOL" v={fmtVolume(q?.volume_average)} />
        <div className="col-span-2 border-t border-term-border pt-2 mt-2">
          <KV k="HQ" v={[p?.hq_address1, p?.hq_address_city, p?.hq_state, p?.hq_country].filter(Boolean).join(", ") || "—"} />
          <KV k="PHONE" v={p?.business_phone_no ?? "—"} />
          <KV k="WEBSITE" v={p?.company_url ? <a href={p.company_url} target="_blank" rel="noreferrer" className="text-term-cyan hover:underline">{p.company_url}</a> : "—"} />
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <div className="sub-header py-0.5">{k}</div>
      <div className="num text-term-text py-0.5 text-right">{v}</div>
    </>
  );
}

export function Loading() {
  return <div className="p-4 text-term-muted text-[11px] tracking-widest uppercase">Loading…</div>;
}
export function ErrorBlock({ err }: { err: Error }) {
  return (
    <div className="p-4 text-term-red text-[12px]">
      <div className="sub-header text-term-red mb-1">ERROR</div>
      {err.message}
    </div>
  );
}
