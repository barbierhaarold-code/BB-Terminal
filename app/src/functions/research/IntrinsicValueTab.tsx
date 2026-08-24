import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchCashFlow, fetchBalance, fetchProfile, fetchQuote, fetchMetrics } from "@/lib/api";
import { fmtPrice, fmtVolume, fmtPct } from "@/lib/format";
import { intrinsicValuePerShare, cagr, DCF_PRESETS, marginOfSafety } from "@/lib/valuation";
import { cn } from "@/lib/cn";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle } from "./shared";

/** Quick, no-knobs intrinsic value estimate — single-stage (Gordon growth)
 * capitalization of trailing FCF. Same math module as the DCF tab, just
 * without the interactive assumptions; a fast sanity check against price. */
export function IntrinsicValueTab({ symbol }: { symbol: string }) {
  const [cashQ, balanceQ, profileQ, quoteQ, metricsQ] = useQueries({
    queries: [
      { queryKey: ["cashflow", symbol], queryFn: () => fetchCashFlow(symbol) },
      { queryKey: ["balance", symbol], queryFn: () => fetchBalance(symbol) },
      { queryKey: ["profile", symbol], queryFn: () => fetchProfile(symbol) },
      { queryKey: ["quote", symbol], queryFn: () => fetchQuote(symbol), refetchInterval: 5000 },
      { queryKey: ["metrics", symbol], queryFn: () => fetchMetrics(symbol) },
    ],
  });

  const cash = useMemo(() => [...(cashQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? 1 : -1)), [cashQ.data]);
  const balance = useMemo(() => [...(balanceQ.data ?? [])].sort((a, b) => (a.period_ending > b.period_ending ? -1 : 1)), [balanceQ.data]);
  const latestBalance = balance[0];
  const p = profileQ.data;
  const q = quoteQ.data;
  const m = metricsQ.data;
  const sharesOutstanding = p?.shares_outstanding ?? 0;
  const netDebt = latestBalance?.net_debt ?? ((latestBalance?.total_debt ?? 0) - (latestBalance?.cash_and_cash_equivalents ?? 0));
  const fcfSeries = useMemo(
    () => cash.map((c) => c.free_cash_flow ?? ((c.operating_cash_flow ?? 0) - Math.abs(c.capital_expenditure ?? 0))),
    [cash]
  );
  const baseFcf = fcfSeries[fcfSeries.length - 1];
  const historicalCagr = cagr(fcfSeries);
  // Conservative growth: cap historical FCF CAGR at the DCF preset so a
  // volatile one-off spike doesn't produce an inflated single-stage value.
  const growthRate = historicalCagr != null ? Math.max(-0.1, Math.min(historicalCagr, DCF_PRESETS.growthRate)) : DCF_PRESETS.growthRate * 0.5;
  const wacc = DCF_PRESETS.wacc;

  const fairValue = useMemo(
    () => (baseFcf != null && sharesOutstanding > 0 ? intrinsicValuePerShare(baseFcf, growthRate, wacc, sharesOutstanding, netDebt) : undefined),
    [baseFcf, growthRate, wacc, sharesOutstanding, netDebt]
  );

  if (cashQ.isLoading || balanceQ.isLoading || profileQ.isLoading) return <Loading />;
  if (cashQ.error) return <ErrorBlock err={cashQ.error as Error} />;
  if (!baseFcf || sharesOutstanding <= 0) {
    return <EmptyBlock>Insufficient free-cash-flow or share-count data to estimate intrinsic value for {symbol}.</EmptyBlock>;
  }

  const price = q?.last_price;
  const mos = marginOfSafety(fairValue, price);

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px] max-w-3xl">
      <div className="panel">
        <div className="panel-header"><span>INTRINSIC VALUE (SINGLE-STAGE)</span></div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-baseline gap-8">
            <div>
              <div className="sub-header">ESTIMATED FAIR VALUE</div>
              <div className="text-4xl num font-bold text-term-amber mt-1">{fmtPrice(fairValue)}</div>
            </div>
            <div>
              <div className="sub-header">CURRENT PRICE</div>
              <div className="text-2xl num text-term-heading mt-1">{fmtPrice(price)}</div>
            </div>
            <div>
              <div className="sub-header">MARGIN OF SAFETY</div>
              <div className={cn("text-2xl num mt-1", mos != null && (mos >= 0 ? "up" : "down"))}>{fmtPct(mos)}</div>
            </div>
          </div>
          <div className="sub-header mt-2">
            MODEL: NEXT-YEAR FCF ÷ (WACC − GROWTH), LESS NET DEBT, ÷ SHARES OUTSTANDING
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>ASSUMPTIONS USED</SectionTitle>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <KV k="BASE FCF (LATEST FY)" v={fmtVolume(baseFcf)} />
          <KV k="GROWTH RATE" v={fmtPct(growthRate * 100)} />
          <KV k="DISCOUNT RATE / WACC" v={fmtPct(wacc * 100)} />
          <KV k="SHARES OUTSTANDING" v={fmtVolume(sharesOutstanding)} />
          <KV k="NET DEBT" v={fmtVolume(netDebt)} />
          <KV k="P/E (TTM)" v={m?.pe_ratio?.toFixed(2) ?? "—"} />
        </div>
        <div className="sub-header mt-3 leading-relaxed max-w-xl">
          Growth is the historical FCF CAGR, capped between −10% and +{fmtPct(DCF_PRESETS.growthRate * 100, 0)} to avoid a
          one-off spike inflating the estimate. Open DCF VALUATION for a multi-year projection with adjustable inputs.
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
