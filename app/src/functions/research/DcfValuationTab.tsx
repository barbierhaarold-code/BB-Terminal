import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchCashFlow, fetchBalance, fetchProfile, fetchQuote } from "@/lib/api";
import { fmtPrice, fmtVolume, fmtPct } from "@/lib/format";
import { runDcf, cagr, DCF_PRESETS, marginOfSafety } from "@/lib/valuation";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle, BarTrend } from "./shared";

/** Multi-year DCF — pure computation on financials FA/the cash-flow fetcher
 * already pull; no new data source, just app/src/lib/valuation.ts. */
export function DcfValuationTab({ symbol }: { symbol: string }) {
  const [growthPct, setGrowthPct] = useState(DCF_PRESETS.growthRate * 100);
  const [waccPct, setWaccPct] = useState(DCF_PRESETS.wacc * 100);
  const [termPct, setTermPct] = useState(DCF_PRESETS.terminalGrowth * 100);
  const [years, setYears] = useState<number>(DCF_PRESETS.years);

  const [cashQ, balanceQ, profileQ, quoteQ] = useQueries({
    queries: [
      { queryKey: ["cashflow", symbol], queryFn: () => fetchCashFlow(symbol) },
      { queryKey: ["balance", symbol], queryFn: () => fetchBalance(symbol) },
      { queryKey: ["profile", symbol], queryFn: () => fetchProfile(symbol) },
      { queryKey: ["quote", symbol], queryFn: () => fetchQuote(symbol), refetchInterval: 5000 },
    ],
  });

  const cash = useMemo(() => [...(cashQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? 1 : -1)), [cashQ.data]); // ascending
  const balance = useMemo(() => [...(balanceQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1)), [balanceQ.data]);
  const latestBalance = balance[0];
  const p = profileQ.data;
  const q = quoteQ.data;
  const sharesOutstanding = p?.shares_outstanding ?? 0;
  const netDebt = latestBalance?.net_debt ?? ((latestBalance?.total_debt ?? 0) - (latestBalance?.cash_and_cash_equivalents ?? 0));

  const fcfSeries = useMemo(
    () => cash.map((c) => c.free_cash_flow ?? ((c.operating_cash_flow ?? 0) - Math.abs(c.capital_expenditure ?? 0))),
    [cash]
  );
  const baseFcf = fcfSeries[fcfSeries.length - 1];
  const historicalCagr = cagr(fcfSeries);

  const result = useMemo(() => runDcf({
    baseFcf: baseFcf ?? 0,
    growthRate: growthPct / 100,
    wacc: waccPct / 100,
    terminalGrowth: termPct / 100,
    years,
    sharesOutstanding,
    netDebt,
  }), [baseFcf, growthPct, waccPct, termPct, years, sharesOutstanding, netDebt]);

  if (cashQ.isLoading || balanceQ.isLoading || profileQ.isLoading) return <Loading />;
  if (cashQ.error) return <ErrorBlock err={cashQ.error as Error} />;
  if (cash.length === 0 || !baseFcf || sharesOutstanding <= 0) {
    return <EmptyBlock>Insufficient free-cash-flow or share-count data to run a DCF for {symbol}.</EmptyBlock>;
  }

  const price = q?.last_price;
  const mos = marginOfSafety(result.fairValuePerShare, price);
  const invalid = waccPct <= termPct;

  return (
    <div className="p-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] text-[12px]">
      <div className="flex flex-col gap-4">
        <div>
          <SectionTitle>ASSUMPTIONS</SectionTitle>
          <div className="flex flex-col gap-3">
            <Slider label="FCF Growth Rate (yrs 1-N)" value={growthPct} onChange={setGrowthPct} min={-20} max={40} step={0.5}
              hint={historicalCagr != null ? `hist. FCF CAGR ${fmtPct(historicalCagr * 100)}` : undefined} />
            <Slider label="Discount Rate / WACC" value={waccPct} onChange={setWaccPct} min={4} max={20} step={0.25} />
            <Slider label="Terminal Growth Rate" value={termPct} onChange={setTermPct} min={0} max={5} step={0.25} />
            <Slider label="Projection Years" value={years} onChange={setYears} min={3} max={10} step={1} isInt />
          </div>
          {invalid && (
            <div className="mt-2 text-term-red text-[11px]">WACC must exceed terminal growth — terminal value is undefined.</div>
          )}
        </div>

        <div>
          <SectionTitle>INPUTS USED</SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <KV k="BASE FCF (LATEST FY)" v={fmtVolume(baseFcf)} />
            <KV k="SHARES OUTSTANDING" v={fmtVolume(sharesOutstanding)} />
            <KV k="NET DEBT" v={fmtVolume(netDebt)} />
            <KV k="CURRENT PRICE" v={fmtPrice(price)} />
          </div>
        </div>

        {fcfSeries.length > 1 && (
          <div>
            <div className="sub-header mb-1.5">HISTORICAL FREE CASH FLOW</div>
            <BarTrend data={cash.map((c, i) => ({ label: c.period_ending.slice(0, 4), value: fcfSeries[i] }))} fmt={fmtVolume} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="panel">
          <div className="panel-header"><span>FAIR VALUE vs. CURRENT PRICE</span></div>
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-baseline gap-6">
              <div>
                <div className="sub-header">DCF FAIR VALUE / SHARE</div>
                <div className="text-3xl num font-bold text-term-amber mt-1">
                  {invalid ? "—" : fmtPrice(result.fairValuePerShare)}
                </div>
              </div>
              <div>
                <div className="sub-header">CURRENT PRICE</div>
                <div className="text-2xl num text-term-heading mt-1">{fmtPrice(price)}</div>
              </div>
              <div>
                <div className="sub-header">MARGIN OF SAFETY</div>
                <div className={cn("text-2xl num mt-1", mos != null && (mos >= 0 ? "up" : "down"))}>
                  {invalid || mos == null ? "—" : fmtPct(mos)}
                </div>
              </div>
            </div>
            {!invalid && price != null && result.fairValuePerShare != null && (
              <ValueBar fairValue={result.fairValuePerShare} price={price} />
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-term-border">
              <KV k="ENTERPRISE VALUE" v={fmtVolume(result.enterpriseValue)} />
              <KV k="EQUITY VALUE" v={fmtVolume(result.equityValue)} />
              <KV k="TERMINAL VALUE (PV)" v={fmtVolume(result.terminalValueDiscounted)} />
              <KV k="SUM PV FCF" v={fmtVolume(result.projection.reduce((a, y) => a + y.discounted, 0))} />
            </div>
          </div>
        </div>

        <div className="panel min-h-0 flex-1">
          <div className="panel-header"><span>PROJECTION</span></div>
          <table className="w-full grid-data">
            <thead><tr><th>Year</th><th className="text-right">Projected FCF</th><th className="text-right">Discounted PV</th></tr></thead>
            <tbody>
              {result.projection.map((y) => (
                <tr key={y.year}>
                  <td className="num">Y{y.year}</td>
                  <td className="num text-right">{fmtVolume(y.fcf)}</td>
                  <td className="num text-right text-term-amber">{fmtVolume(y.discounted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sub-header p-2">RULE-BASED VALUATION MODEL · NOT INVESTMENT ADVICE</div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label, value, onChange, min, max, step, hint, isInt,
}: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; hint?: string; isInt?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="sub-header normal-case tracking-wide">{label}</span>
        <span className="num text-term-amber text-[12px]">{isInt ? value : `${value.toFixed(2)}%`}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#b45cff]"
      />
      {hint && <div className="sub-header mt-0.5 normal-case">{hint}</div>}
    </div>
  );
}

function ValueBar({ fairValue, price }: { fairValue: number; price: number }) {
  const lo = Math.min(fairValue, price) * 0.9;
  const hi = Math.max(fairValue, price) * 1.1;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="relative h-8 mt-1">
      <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 bg-term-border" />
      <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${pos(price)}%` }}>
        <div className="w-0.5 h-4 bg-term-text -translate-y-2" />
        <div className="text-[10px] text-term-text whitespace-nowrap -translate-x-1/2">PRICE {fmtPrice(price)}</div>
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${pos(fairValue)}%` }}>
        <div className="w-0.5 h-4 bg-term-amber -translate-y-2" />
        <div className="text-[10px] text-term-amber whitespace-nowrap -translate-x-1/2">FAIR {fmtPrice(fairValue)}</div>
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
