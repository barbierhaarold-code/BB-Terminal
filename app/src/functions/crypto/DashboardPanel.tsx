import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchCryptoHistorical } from "@/lib/api";
import { fmtPrice, fmtPct, fmtVolume } from "@/lib/format";
import { COINS } from "@/lib/crypto";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";
import { fetchFearGreed } from "./fearGreed";
import { fetchAltcoinSeason } from "./altcoinSeason";
import { SectionTitle } from "@/functions/research/shared";

function Meter({ value, low, high, lowLabel, highLabel }: {
  value: number; low: number; high: number; lowLabel: string; highLabel: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct <= low ? "bg-term-red" : pct >= high ? "bg-term-green" : "bg-term-amber";
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="relative h-2 w-full bg-term-panel2 border border-term-border">
        <div className={cn("absolute inset-y-0 left-0", color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[9px] text-term-muted uppercase tracking-wider">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

function GaugeCard({ title, value, label, sub, low = 25, high = 75, lowLabel, highLabel, error }: {
  title: string; value: number | undefined; label: string | undefined; sub: string;
  low?: number; high?: number; lowLabel: string; highLabel: string; error?: Error | null;
}) {
  return (
    <div className="border border-term-border px-3 py-2 flex flex-col gap-2 min-w-[220px] flex-1">
      <div className="sub-header">{title}</div>
      {error ? (
        <div className="text-term-red text-[11px] py-2">{error.message}</div>
      ) : value == null ? (
        <div className="text-term-muted text-[11px] py-2">Loading…</div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <div className="num text-[22px] text-term-heading">{Math.round(value)}</div>
            <div className="text-[12px] text-term-amberBright uppercase">{label}</div>
          </div>
          <Meter value={value} low={low} high={high} lowLabel={lowLabel} highLabel={highLabel} />
          <div className="text-[10px] text-term-muted">{sub}</div>
        </>
      )}
    </div>
  );
}

export function DashboardPanel() {
  const openTab = useWorkspace((s) => s.openTab);
  const queries = useQueries({
    queries: COINS.map((c) => ({
      queryKey: ["crypto-hist", c.sym],
      queryFn: () => fetchCryptoHistorical(c.sym, 14),
      refetchInterval: 60_000,
    })),
  });

  const fngQ = useQuery({ queryKey: ["crypto-fng"], queryFn: () => fetchFearGreed(30), staleTime: 10 * 60_000, refetchInterval: 10 * 60_000 });
  const altQ = useQuery({ queryKey: ["crypto-altseason"], queryFn: fetchAltcoinSeason, staleTime: 15 * 60_000, refetchInterval: 15 * 60_000 });

  const fng = fngQ.data?.[0];
  const fngWeekAgo = fngQ.data?.[7];

  return (
    <div className="p-3 text-[12px] flex flex-col gap-4">
      <div>
        <SectionTitle>SENTIMENT</SectionTitle>
        <div className="flex gap-3 flex-wrap">
          <GaugeCard
            title="FEAR & GREED INDEX"
            value={fng?.value}
            label={fng?.classification}
            sub={fngWeekAgo ? `${fngWeekAgo.value} (${fngWeekAgo.classification}) a week ago` : "alternative.me · daily"}
            lowLabel="Extreme Fear"
            highLabel="Extreme Greed"
            error={fngQ.error as Error | null}
          />
          <GaugeCard
            title="ALTCOIN SEASON INDEX"
            value={altQ.data?.index}
            label={altQ.data?.label}
            sub={altQ.data ? `${altQ.data.outperformers}/${altQ.data.tracked} of top alts beat BTC over ${altQ.data.windowDays}d` : "CoinGecko · self-computed"}
            lowLabel="Bitcoin Season"
            highLabel="Altcoin Season"
            error={altQ.error as Error | null}
          />
        </div>
      </div>

      <div>
        <SectionTitle>TOP CRYPTOCURRENCIES</SectionTitle>
        <table className="w-full grid-data">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th className="text-right">Price</th>
              <th className="text-right">24h Δ</th>
              <th className="text-right">24h %</th>
              <th className="text-right">Volume</th>
              <th className="text-right">14d Trend</th>
            </tr>
          </thead>
          <tbody>
            {COINS.map((c, i) => {
              const q = queries[i];
              const data = q.data ?? [];
              const last = data[data.length - 1];
              const prev = data[data.length - 2];
              const chg = last && prev ? last.close - prev.close : undefined;
              const chgPct = last && prev ? ((last.close - prev.close) / prev.close) * 100 : undefined;
              const dir = chgPct == null ? "flat" : chgPct >= 0 ? "up" : "down";
              const vals = data.map((d) => d.close);
              const min = Math.min(...vals), max = Math.max(...vals);
              const spark = vals.length > 1 ? vals.map((v, idx) => {
                const x = (idx / (vals.length - 1)) * 100;
                const y = 24 - ((v - min) / (max - min || 1)) * 20;
                return `${x},${y}`;
              }).join(" ") : "";
              return (
                <tr key={c.sym} onClick={() => openTab("GP", c.sym)} className="cursor-pointer hover:bg-term-amberSubtle">
                  <td className="num text-term-amber font-semibold">{c.sym.replace("-USD", "")}</td>
                  <td className="text-term-heading">{c.name}</td>
                  <td className="num text-right">{fmtPrice(last?.close, last?.close != null && last.close < 1 ? 4 : 2)}</td>
                  <td className={cn("num text-right", dir === "up" && "up", dir === "down" && "down")}>
                    {chg == null ? "—" : (chg >= 0 ? "+" : "") + fmtPrice(chg, chg && Math.abs(chg) < 1 ? 4 : 2)}
                  </td>
                  <td className={cn("num text-right", dir === "up" && "up", dir === "down" && "down")}>{fmtPct(chgPct)}</td>
                  <td className="num text-right text-term-muted">{fmtVolume(last?.volume)}</td>
                  <td className="text-right">
                    {spark && (
                      <svg viewBox="0 0 100 24" className="w-24 h-6 inline-block">
                        <polyline fill="none" stroke={dir === "up" ? "#22ee22" : dir === "down" ? "#ff3b3b" : "#b45cff"} strokeWidth="1.2" points={spark} />
                      </svg>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="sub-header mt-3">14-DAY TREND · YFINANCE · 60S REFRESH</div>
      </div>
    </div>
  );
}
