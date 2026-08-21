import { useQueries } from "@tanstack/react-query";
import { fetchCryptoHistorical } from "@/lib/api";
import { fmtPrice, fmtPct, fmtVolume } from "@/lib/format";
import { COINS } from "@/lib/crypto";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";

export function CRYPTO() {
  const openTab = useWorkspace((s) => s.openTab);
  const queries = useQueries({
    queries: COINS.map((c) => ({
      queryKey: ["crypto-hist", c.sym],
      queryFn: () => fetchCryptoHistorical(c.sym, 14),
      refetchInterval: 60_000,
    })),
  });

  return (
    <div className="p-3 text-[12px]">
      <div className="text-term-amber text-[10px] tracking-[0.25em] font-bold border-b border-term-border pb-1 mb-2">TOP CRYPTOCURRENCIES</div>
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
  );
}
