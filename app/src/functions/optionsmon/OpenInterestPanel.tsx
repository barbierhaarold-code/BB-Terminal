import { useMemo, useState } from "react";
import { fmtVolume } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useOptionsChain } from "./useOptionsChain";

type Scope = "expiry" | "all";

export function OpenInterestPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error, expirations, underlying } = useOptionsChain(symbol);
  const [exp, setExp] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("expiry");
  const expToShow = exp ?? expirations[0];

  const rows = useMemo(() => {
    if (scope === "all") return data;
    if (!expToShow) return [];
    return data.filter((o) => o.expiration === expToShow);
  }, [data, scope, expToShow]);

  const byStrike = useMemo(() => {
    const m = new Map<number, { call: number; put: number }>();
    for (const r of rows) {
      const entry = m.get(r.strike) ?? { call: 0, put: 0 };
      const oi = r.open_interest ?? 0;
      if (r.option_type === "call") entry.call += oi; else entry.put += oi;
      m.set(r.strike, entry);
    }
    return Array.from(m.entries())
      .map(([strike, v]) => ({ strike, ...v }))
      .sort((a, b) => a.strike - b.strike);
  }, [rows]);

  const totalCall = byStrike.reduce((s, r) => s + r.call, 0);
  const totalPut = byStrike.reduce((s, r) => s + r.put, 0);
  const pcRatio = totalCall > 0 ? totalPut / totalCall : null;

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading open interest…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[11px] uppercase tracking-wider overflow-x-auto scroll-thin">
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setScope("expiry")}
            className={cn("px-2 py-0.5 border", scope === "expiry" ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            THIS EXPIRY
          </button>
          <button onClick={() => setScope("all")}
            className={cn("px-2 py-0.5 border", scope === "all" ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            ALL EXPIRIES
          </button>
        </div>
        {scope === "expiry" && (
          <>
            <span className="text-term-amber shrink-0">EXP</span>
            {expirations.slice(0, 14).map((e) => (
              <button key={e} onClick={() => setExp(e)}
                className={cn("px-2 py-0.5 border num shrink-0",
                  e === expToShow ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
                {e}
              </button>
            ))}
          </>
        )}
        <span className="ml-auto text-term-muted shrink-0">
          CALL OI <span className="text-term-green num ml-1">{fmtVolume(totalCall)}</span>
          &nbsp;·&nbsp;PUT OI <span className="text-term-red num ml-1">{fmtVolume(totalPut)}</span>
          &nbsp;·&nbsp;P/C <span className="text-term-heading num ml-1">{pcRatio != null ? pcRatio.toFixed(2) : "—"}</span>
        </span>
      </div>
      <div className="p-3 border-b border-term-border">
        <OiBarChart rows={byStrike} underlying={underlying} />
      </div>
      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-[11.5px] grid-data">
          <thead>
            <tr>
              <th className="text-right up">CALL OI</th>
              <th className="text-center amber !bg-term-panel !text-term-amber">STRIKE</th>
              <th className="text-right down">PUT OI</th>
            </tr>
          </thead>
          <tbody>
            {byStrike.map(({ strike, call, put }) => {
              const itm = underlying != null && strike <= underlying;
              return (
                <tr key={strike}>
                  <td className={cn("num text-right up", itm && "bg-term-amberSubtle")}>{fmtVolume(call)}</td>
                  <td className="text-center amber num font-bold">{strike}</td>
                  <td className={cn("num text-right down", !itm && "bg-term-amberSubtle")}>{fmtVolume(put)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OiBarChart({ rows, underlying }: { rows: { strike: number; call: number; put: number }[]; underlying: number | undefined }) {
  if (rows.length === 0) return <div className="text-term-muted text-[11px] uppercase tracking-widest p-4">No data.</div>;
  const W = 800, H = 200, padL = 44, padR = 16, padT = 12, padB = 22;
  const midY = padT + (H - padT - padB) / 2;
  const maxOi = Math.max(...rows.map((r) => Math.max(r.call, r.put)), 1);
  const barW = Math.max((W - padL - padR) / rows.length - 2, 1);
  const xFor = (i: number) => padL + i * ((W - padL - padR) / rows.length);
  const hFor = (v: number) => (v / maxOi) * (midY - padT);

  return (
    <div className="relative border border-term-border bg-term-bg2 min-h-[200px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke="#2a2a2a" />
        {rows.map((r, i) => (
          <g key={r.strike}>
            <rect x={xFor(i)} y={midY - hFor(r.call)} width={barW} height={hFor(r.call)} fill="#22ee22" opacity={0.8} />
            <rect x={xFor(i)} y={midY} width={barW} height={hFor(r.put)} fill="#ff3b3b" opacity={0.8} />
          </g>
        ))}
        {underlying != null && (
          <>
            {(() => {
              let bestI = 0, bestDiff = Infinity;
              rows.forEach((r, i) => { const d = Math.abs(r.strike - underlying); if (d < bestDiff) { bestDiff = d; bestI = i; } });
              const x = xFor(bestI) + barW / 2;
              return <line x1={x} y1={padT} x2={x} y2={H - padB} stroke="#b45cff" strokeDasharray="3,3" />;
            })()}
          </>
        )}
        {rows.filter((_, i) => i % Math.ceil(rows.length / 12 || 1) === 0).map((r) => {
          const i = rows.indexOf(r);
          return <text key={r.strike} x={xFor(i) + barW / 2} y={H - padB + 12} fontSize="9" textAnchor="middle" fill="#6e6e6e">{r.strike}</text>;
        })}
      </svg>
      <div className="absolute top-2 right-3 text-[10px] uppercase tracking-widest text-term-muted flex items-center gap-3">
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-term-green" />CALLS</span>
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-term-red" />PUTS</span>
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-term-amber" />SPOT</span>
      </div>
    </div>
  );
}
