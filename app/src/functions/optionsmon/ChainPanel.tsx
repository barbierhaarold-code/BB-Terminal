import { useMemo, useState } from "react";
import { fmtPrice, fmtVolume } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useOptionsChain } from "./useOptionsChain";

export function ChainPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error, expirations, underlying } = useOptionsChain(symbol);

  const [exp, setExp] = useState<string | null>(null);
  const expToShow = exp ?? expirations[0];

  const rows = useMemo(() => {
    if (!expToShow) return [];
    return data.filter((o) => o.expiration === expToShow);
  }, [data, expToShow]);

  // Build strike rows with call/put side by side
  const strikes = useMemo(() => {
    const m: Record<number, { call?: typeof rows[number]; put?: typeof rows[number] }> = {};
    for (const r of rows) {
      m[r.strike] = m[r.strike] ?? {};
      if (r.option_type === "call") m[r.strike].call = r;
      else m[r.strike].put = r;
    }
    return Object.entries(m)
      .map(([k, v]) => ({ strike: Number(k), ...v }))
      .sort((a, b) => a.strike - b.strike);
  }, [rows]);

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading options…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[11px] uppercase tracking-wider overflow-x-auto scroll-thin">
        <span className="text-term-amber shrink-0">EXP</span>
        {expirations.slice(0, 14).map((e) => (
          <button key={e} onClick={() => setExp(e)}
            className={cn("px-2 py-0.5 border num shrink-0",
              e === expToShow ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {e}
          </button>
        ))}
        <span className="ml-auto text-term-muted shrink-0">
          UNDERLYING <span className="text-term-heading num ml-1">{fmtPrice(underlying)}</span>
          &nbsp;·&nbsp;{strikes.length} strikes
        </span>
      </div>
      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-[11.5px] grid-data">
          <thead>
            <tr>
              <th colSpan={5} className="text-center up border-l border-term-border">CALLS</th>
              <th className="text-center amber !bg-term-panel !text-term-amber">STRIKE</th>
              <th colSpan={5} className="text-center down border-r border-term-border">PUTS</th>
            </tr>
            <tr>
              <th className="text-right">OI</th>
              <th className="text-right">Vol</th>
              <th className="text-right">IV</th>
              <th className="text-right">Bid</th>
              <th className="text-right">Ask</th>
              <th className="text-center">$</th>
              <th className="text-right">Bid</th>
              <th className="text-right">Ask</th>
              <th className="text-right">IV</th>
              <th className="text-right">Vol</th>
              <th className="text-right">OI</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map(({ strike, call, put }) => {
              const itmCall = underlying != null && strike <= underlying;
              const itmPut = underlying != null && strike >= underlying;
              return (
                <tr key={strike}>
                  <td className={cn("num text-right text-term-muted", itmCall && "bg-term-amberSubtle")}>{fmtVolume(call?.open_interest)}</td>
                  <td className={cn("num text-right text-term-muted", itmCall && "bg-term-amberSubtle")}>{fmtVolume(call?.volume)}</td>
                  <td className={cn("num text-right text-term-text", itmCall && "bg-term-amberSubtle")}>{call?.implied_volatility != null ? (call.implied_volatility * 100).toFixed(1) + "%" : "—"}</td>
                  <td className={cn("num text-right up", itmCall && "bg-term-amberSubtle")}>{fmtPrice(call?.bid)}</td>
                  <td className={cn("num text-right up", itmCall && "bg-term-amberSubtle")}>{fmtPrice(call?.ask)}</td>
                  <td className="text-center amber num font-bold">{fmtPrice(strike)}</td>
                  <td className={cn("num text-right down", itmPut && "bg-term-amberSubtle")}>{fmtPrice(put?.bid)}</td>
                  <td className={cn("num text-right down", itmPut && "bg-term-amberSubtle")}>{fmtPrice(put?.ask)}</td>
                  <td className={cn("num text-right text-term-text", itmPut && "bg-term-amberSubtle")}>{put?.implied_volatility != null ? (put.implied_volatility * 100).toFixed(1) + "%" : "—"}</td>
                  <td className={cn("num text-right text-term-muted", itmPut && "bg-term-amberSubtle")}>{fmtVolume(put?.volume)}</td>
                  <td className={cn("num text-right text-term-muted", itmPut && "bg-term-amberSubtle")}>{fmtVolume(put?.open_interest)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1 border-t border-term-border sub-header">HIGHLIGHTED ROWS = IN THE MONEY</div>
    </div>
  );
}
