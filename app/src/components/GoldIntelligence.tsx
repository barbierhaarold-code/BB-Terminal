import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchHistorical, fetchFxHistorical, fetchCryptoHistorical, fetchGoldCot,
  type Candle,
} from "@/lib/api";
import { rollingCorrelation, correlationSignal, type CorrelationTone } from "@/lib/correlation";
import { GOLD_FUT, DXY } from "@/lib/forex";
import { fmtPct, fmtInt, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const FETCH_DAYS = 45;
const CORR_WINDOW = 20;

function dailyPctChange(candles?: Candle[]): number | undefined {
  if (!candles || candles.length < 2) return undefined;
  const last = candles[candles.length - 1], prev = candles[candles.length - 2];
  return prev.close ? ((last.close - prev.close) / prev.close) * 100 : undefined;
}

// ────────────────────────────────────────────────────────────
// Risk regime — four proxies rolled into a plain-language read. Rule-based,
// not a model: each driver counts as supportive/headwind for gold only when
// its move clears a noise floor, then the four are summed into one verdict.
// ────────────────────────────────────────────────────────────
type Direction = "up" | "down";
interface Driver { key: string; label: string; symbol: string; minMovePct: number; supportiveWhen: Direction; }

const DRIVERS: Driver[] = [
  { key: "dollar", label: "US Dollar (UUP)", symbol: "UUP", minMovePct: 0.1, supportiveWhen: "down" },
  { key: "rates", label: "7-10Y Treasuries (IEF)", symbol: "IEF", minMovePct: 0.1, supportiveWhen: "up" },
  { key: "vol", label: "Volatility (VIXY)", symbol: "VIXY", minMovePct: 1.0, supportiveWhen: "up" },
  { key: "eur", label: "EUR/USD", symbol: "EURUSD=X", minMovePct: 0.1, supportiveWhen: "up" },
];

function driverRead(pct: number | undefined, d: Driver): "supportive" | "headwind" | "flat" {
  if (pct == null || Math.abs(pct) < d.minMovePct) return "flat";
  const dir: Direction = pct >= 0 ? "up" : "down";
  return dir === d.supportiveWhen ? "supportive" : "headwind";
}

function regimeVerdict(score: number): { label: string; tone: CorrelationTone } {
  if (score >= 2) return { label: "RISK-OFF · TAILWIND FOR GOLD", tone: "confirm" };
  if (score <= -2) return { label: "RISK-ON · HEADWIND FOR GOLD", tone: "diverge" };
  return { label: "MIXED — NO CLEAR REGIME", tone: "neutral" };
}

// ────────────────────────────────────────────────────────────
// Correlation grid pairs
// ────────────────────────────────────────────────────────────
interface CorrPair { label: string; queryKey: string; fetcher: () => Promise<Candle[]>; }

const CORR_PAIRS: CorrPair[] = [
  { label: "XAU/USD × DXY", queryKey: DXY.symbol, fetcher: () => fetchHistorical(DXY.symbol, dailyOpts()) },
  { label: "XAU/USD × Silver (SLV)", queryKey: "SLV", fetcher: () => fetchHistorical("SLV", dailyOpts()) },
  { label: "XAU/USD × EUR/USD", queryKey: "EURUSD=X-corr", fetcher: () => fetchFxHistorical("EURUSD=X", FETCH_DAYS) },
  { label: "XAU/USD × Bitcoin", queryKey: "BTC-USD-corr", fetcher: () => fetchCryptoHistorical("BTC-USD", FETCH_DAYS) },
];

function dailyOpts() {
  const start_date = new Date(Date.now() - FETCH_DAYS * 864e5).toISOString().slice(0, 10);
  return { interval: "1d", start_date };
}

const TONE_CLASS: Record<CorrelationTone, string> = {
  confirm: "text-term-green border-term-green/40",
  diverge: "text-term-amberBright border-term-amberDim",
  decorrelated: "text-term-red border-term-red/40",
  neutral: "text-term-muted border-term-borderSoft",
};

// Static WGC annual snapshot — the World Gold Council publishes quarterly
// Gold Demand Trends with a central-bank net-purchases breakdown by
// country; there's no free live API for it, only a hand-refreshed snapshot
// (same pattern as the equity universe's market-cap figures in
// lib/universe.ts). Figures are the widely-reported 2023 full-year net
// buyers — refresh by hand from the latest WGC release, don't treat as live.
const CENTRAL_BANK_BUYERS = [
  { country: "China (PBoC)", tonnes: 225 },
  { country: "Poland", tonnes: 130 },
  { country: "Singapore", tonnes: 77 },
  { country: "Libya", tonnes: 30 },
  { country: "India (RBI)", tonnes: 29 },
  { country: "Czech Republic", tonnes: 19 },
];

export function GoldIntelligence() {
  const start_date = new Date(Date.now() - FETCH_DAYS * 864e5).toISOString().slice(0, 10);

  const gold = useQuery({
    queryKey: ["gi-daily", GOLD_FUT.symbol],
    queryFn: () => fetchHistorical(GOLD_FUT.symbol, { interval: "1d", start_date }),
    staleTime: 300_000,
  });

  const driverQueries = useQueries({
    queries: DRIVERS.map((d) => ({
      queryKey: ["gi-driver", d.symbol],
      queryFn: () => fetchHistorical(d.symbol, { interval: "1d", start_date }),
      staleTime: 300_000,
    })),
  });

  const corrQueries = useQueries({
    queries: CORR_PAIRS.map((p) => ({
      queryKey: ["gi-corr", p.queryKey],
      queryFn: p.fetcher,
      staleTime: 300_000,
    })),
  });

  const cot = useQuery({
    queryKey: ["gi-cot-gold"],
    queryFn: fetchGoldCot,
    staleTime: 6 * 60 * 60_000,
  });

  const goldData = gold.data ?? [];
  const goldPct = dailyPctChange(goldData);

  // Risk regime
  const driverReads = DRIVERS.map((d, i) => {
    const pct = dailyPctChange(driverQueries[i].data as Candle[] | undefined);
    return { driver: d, pct, read: driverRead(pct, d) };
  });
  const score = driverReads.reduce((s, r) => s + (r.read === "supportive" ? 1 : r.read === "headwind" ? -1 : 0), 0);
  const verdict = regimeVerdict(score);
  const regimeLoading = driverQueries.some((q) => q.isLoading && !q.data);

  // Correlation grid
  const corrRows = CORR_PAIRS.map((p, i) => {
    const data = (corrQueries[i].data as Candle[] | undefined) ?? [];
    const corr = rollingCorrelation(goldData, data, CORR_WINDOW);
    const pct = dailyPctChange(data);
    const signal = correlationSignal(corr, goldPct, pct);
    return { pair: p, corr, pct, signal };
  });
  const corrLoading = (gold.isLoading && !gold.data) || corrQueries.some((q) => q.isLoading && !q.data);

  return (
    <div className="panel">
      <div className="panel-header">
        <span>GOLD INTELLIGENCE</span>
        <span className="sub-header normal-case tracking-normal font-normal">
          rule-based reads · not investment advice
        </span>
      </div>

      <div className="p-2 flex flex-col gap-2">
        {/* Risk regime */}
        <div className="border border-term-borderSoft">
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-term-borderSoft">
            <span className="sub-header">RISK REGIME</span>
            {!regimeLoading && (
              <span className={cn("text-[11px] font-bold px-1.5 py-0.5 border", TONE_CLASS[verdict.tone])}>
                {verdict.label}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
            {driverReads.map(({ driver, pct, read }) => (
              <div key={driver.key} className="px-2 py-1.5 border border-term-borderSoft">
                <div className="sub-header truncate">{driver.label}</div>
                <div className={cn("num text-[14px] mt-0.5", pct != null && pct >= 0 && "up", pct != null && pct < 0 && "down")}>
                  {regimeLoading ? "…" : fmtPct(pct)}
                </div>
                <div className={cn(
                  "text-[10px] uppercase tracking-wider mt-0.5",
                  read === "supportive" && "text-term-green",
                  read === "headwind" && "text-term-red",
                  read === "flat" && "text-term-muted"
                )}>
                  {read}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Correlation grid */}
        <div className="border border-term-borderSoft">
          <div className="px-2 py-1.5 sub-header border-b border-term-borderSoft">
            CORRELATION GRID · {CORR_WINDOW}D ROLLING
          </div>
          <div className="grid grid-cols-2 gap-2 p-2">
            {corrRows.map(({ pair, corr, pct, signal }) => (
              <div key={pair.label} className="px-2 py-1.5 border border-term-borderSoft">
                <div className="flex items-center justify-between">
                  <span className="sub-header">{pair.label}</span>
                  <span className="num text-[11px] text-term-muted">
                    {corrLoading ? "…" : corr != null ? `r=${corr.toFixed(2)}` : "r=—"}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className={cn("num text-[13px]", pct != null && pct >= 0 && "up", pct != null && pct < 0 && "down")}>
                    {corrLoading ? "…" : fmtPct(pct)}
                  </span>
                  <span className={cn("text-[10px] font-bold px-1 py-0.5 border", TONE_CLASS[signal.tone])}>
                    {corrLoading ? "" : signal.label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* COT report */}
        <div className="border border-term-borderSoft">
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-term-borderSoft">
            <span className="sub-header">COT · GOLD (NON-COMMERCIAL) · TRADINGSTER / CFTC</span>
            {cot.data && <span className="sub-header normal-case tracking-normal font-normal">as of {fmtDate(cot.data.asOf)}</span>}
          </div>
          {cot.isLoading ? (
            <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]">Loading COT report…</div>
          ) : cot.error || !cot.data ? (
            <div className="p-3 text-term-red text-[12px]">{(cot.error as Error)?.message ?? "COT report unavailable."}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-2">
              <CotCell label="LONGS" value={fmtInt(cot.data.nonCommercialLong)} change={cot.data.nonCommercialLongChange} />
              <CotCell label="SHORTS" value={fmtInt(cot.data.nonCommercialShort)} change={cot.data.nonCommercialShortChange} />
              <CotCell
                label="NET"
                value={fmtInt(cot.data.nonCommercialLong - cot.data.nonCommercialShort)}
                change={cot.data.nonCommercialLongChange - cot.data.nonCommercialShortChange}
              />
              <CotCell
                label="% LONGS"
                value={fmtPct(
                  (cot.data.nonCommercialLong / (cot.data.nonCommercialLong + cot.data.nonCommercialShort)) * 100,
                  1
                ).replace("+", "")}
              />
              <CotCell label="OPEN INTEREST" value={fmtInt(cot.data.openInterest)} />
            </div>
          )}
        </div>

        {/* Central bank purchases */}
        <div className="border border-term-borderSoft">
          <div className="px-2 py-1.5 sub-header border-b border-term-borderSoft">
            CENTRAL BANK NET BUYERS · WGC ANNUAL SNAPSHOT (STATIC)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-2">
            {CENTRAL_BANK_BUYERS.map((b) => (
              <div key={b.country} className="flex items-center justify-between px-2 py-1 text-[11px]">
                <span className="text-term-text">{b.country}</span>
                <span className="num text-term-amber">{b.tonnes}t</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CotCell({ label, value, change }: { label: string; value: string; change?: number }) {
  return (
    <div className="px-2 py-1.5 border border-term-borderSoft">
      <div className="sub-header">{label}</div>
      <div className="num text-[15px] text-term-heading mt-0.5">{value}</div>
      {change != null && (
        <div className={cn("num text-[10px] mt-0.5", change >= 0 && "up", change < 0 && "down")}>
          {change >= 0 ? "+" : ""}{fmtInt(change)} WoW
        </div>
      )}
    </div>
  );
}
