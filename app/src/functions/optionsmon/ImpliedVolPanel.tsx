import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useOptionsChain } from "./useOptionsChain";
import { useRiskFreeRate } from "./useRiskFreeRate";
import { atmIv, groupByExpiry } from "./chainMath";
import { blackScholesDelta, DAYS_PER_YEAR } from "@/lib/greeks";

export function ImpliedVolPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error, expirations, underlying } = useOptionsChain(symbol);
  const riskFreeRate = useRiskFreeRate();
  const [exp, setExp] = useState<string | null>(null);
  const expToShow = exp ?? expirations[0];

  const byExpiry = useMemo(() => groupByExpiry(data), [data]);

  // ── Term structure: ATM IV per expiry, x = DTE ──
  const termPoints = useMemo(() => {
    if (!underlying) return [];
    return expirations
      .map((e) => {
        const rows = byExpiry.get(e) ?? [];
        const dte = rows[0]?.dte ?? 0;
        const iv = atmIv(data, e, underlying);
        return iv != null ? { expiration: e, dte, iv } : null;
      })
      .filter((p): p is { expiration: string; dte: number; iv: number } => p != null)
      .sort((a, b) => a.dte - b.dte);
  }, [expirations, byExpiry, data, underlying]);

  // ── Skew: IV vs strike for the selected expiry, plus 25-delta markers ──
  const skew = useMemo(() => {
    if (!underlying || !expToShow) return null;
    const rows = byExpiry.get(expToShow) ?? [];
    const dte = rows[0]?.dte ?? 0;
    const T = Math.max(dte, 1) / DAYS_PER_YEAR;

    const calls = rows
      .filter((r) => r.option_type === "call" && r.implied_volatility != null)
      .map((r) => ({ strike: r.strike, iv: r.implied_volatility as number }))
      .sort((a, b) => a.strike - b.strike);
    const puts = rows
      .filter((r) => r.option_type === "put" && r.implied_volatility != null)
      .map((r) => ({ strike: r.strike, iv: r.implied_volatility as number }))
      .sort((a, b) => a.strike - b.strike);

    let best25Call: { strike: number; iv: number; delta: number } | null = null;
    let best25Put: { strike: number; iv: number; delta: number } | null = null;
    for (const c of calls) {
      const d = blackScholesDelta(underlying, c.strike, T, riskFreeRate, c.iv, "call");
      if (!best25Call || Math.abs(d - 0.25) < Math.abs(best25Call.delta - 0.25)) {
        best25Call = { strike: c.strike, iv: c.iv, delta: d };
      }
    }
    for (const p of puts) {
      const d = blackScholesDelta(underlying, p.strike, T, riskFreeRate, p.iv, "put");
      if (!best25Put || Math.abs(d - -0.25) < Math.abs(best25Put.delta - -0.25)) {
        best25Put = { strike: p.strike, iv: p.iv, delta: d };
      }
    }
    return { calls, puts, best25Call, best25Put, dte };
  }, [byExpiry, expToShow, underlying, riskFreeRate]);

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading implied volatility…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (termPoints.length === 0) {
    return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">No IV data available for this chain.</div>;
  }

  const skewValue = skew?.best25Put && skew?.best25Call ? skew.best25Put.iv - skew.best25Call.iv : null;

  return (
    <div className="h-full flex flex-col overflow-auto scroll-thin">
      <div className="p-3 border-b border-term-border">
        <div className="sub-header mb-2">TERM STRUCTURE — ATM IV BY EXPIRY</div>
        <TermStructureChart points={termPoints} />
      </div>
      <div className="p-3 flex-1">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <div className="sub-header">25-DELTA SKEW</div>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider overflow-x-auto scroll-thin">
            {expirations.slice(0, 14).map((e) => (
              <button key={e} onClick={() => setExp(e)}
                className={cn("px-2 py-0.5 border num shrink-0",
                  e === expToShow ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
                {e}
              </button>
            ))}
          </div>
          {skewValue != null && (
            <div className="ml-auto flex items-baseline gap-2 shrink-0">
              <span className="text-term-muted text-[11px] uppercase tracking-wider">SKEW (25Δ PUT − 25Δ CALL)</span>
              <span className={cn("num font-bold", skewValue >= 0 ? "up" : "down")}>{(skewValue * 100).toFixed(2)} pts</span>
            </div>
          )}
        </div>
        {skew && underlying ? (
          <SkewChart skew={skew} underlying={underlying} />
        ) : (
          <div className="text-term-muted text-[11px] uppercase tracking-widest p-4">No data for this expiry.</div>
        )}
      </div>
    </div>
  );
}

function TermStructureChart({ points }: { points: { expiration: string; dte: number; iv: number }[] }) {
  const W = 800, H = 180, padL = 44, padR = 16, padT = 16, padB = 26;
  const minDte = 0;
  const maxDte = Math.max(...points.map((p) => p.dte), 1);
  const ivs = points.map((p) => p.iv);
  const minIv = Math.min(...ivs) * 0.9;
  const maxIv = Math.max(...ivs) * 1.1;
  const xFor = (dte: number) => padL + ((dte - minDte) / (maxDte - minDte || 1)) * (W - padL - padR);
  const yFor = (iv: number) => padT + (1 - (iv - minIv) / (maxIv - minIv || 1)) * (H - padT - padB);
  const path = points.map((p) => `${xFor(p.dte)},${yFor(p.iv)}`).join(" ");

  return (
    <div className="relative border border-term-border bg-term-bg2 min-h-[180px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        {[minIv, (minIv + maxIv) / 2, maxIv].map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={yFor(v)} x2={W - padR} y2={yFor(v)} stroke="#1f1f1f" />
            <text x={padL - 4} y={yFor(v) + 3} fontSize="9" textAnchor="end" fill="#6e6e6e">{(v * 100).toFixed(1)}%</text>
          </g>
        ))}
        {points.map((p) => (
          <text key={p.expiration} x={xFor(p.dte)} y={H - padB + 14} fontSize="9" textAnchor="middle" fill="#6e6e6e">{p.dte}d</text>
        ))}
        <polyline fill="none" stroke="#b45cff" strokeWidth="2" points={path} />
        {points.map((p) => (
          <circle key={p.expiration} cx={xFor(p.dte)} cy={yFor(p.iv)} r="3" fill="#b45cff" />
        ))}
      </svg>
    </div>
  );
}

interface SkewData {
  calls: { strike: number; iv: number }[];
  puts: { strike: number; iv: number }[];
  best25Call: { strike: number; iv: number; delta: number } | null;
  best25Put: { strike: number; iv: number; delta: number } | null;
}

function SkewChart({ skew, underlying }: { skew: SkewData; underlying: number }) {
  const W = 800, H = 220, padL = 44, padR = 16, padT = 16, padB = 26;
  const allStrikes = [...skew.calls.map((c) => c.strike), ...skew.puts.map((p) => p.strike)];
  const allIvs = [...skew.calls.map((c) => c.iv), ...skew.puts.map((p) => p.iv)];
  if (allStrikes.length === 0) return null;
  const minK = Math.min(...allStrikes, underlying);
  const maxK = Math.max(...allStrikes, underlying);
  const minIv = Math.min(...allIvs) * 0.9;
  const maxIv = Math.max(...allIvs) * 1.1;
  const xFor = (k: number) => padL + ((k - minK) / (maxK - minK || 1)) * (W - padL - padR);
  const yFor = (iv: number) => padT + (1 - (iv - minIv) / (maxIv - minIv || 1)) * (H - padT - padB);

  const callPath = skew.calls.map((c) => `${xFor(c.strike)},${yFor(c.iv)}`).join(" ");
  const putPath = skew.puts.map((p) => `${xFor(p.strike)},${yFor(p.iv)}`).join(" ");

  return (
    <div className="relative border border-term-border bg-term-bg2 min-h-[220px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        {[minIv, (minIv + maxIv) / 2, maxIv].map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={yFor(v)} x2={W - padR} y2={yFor(v)} stroke="#1f1f1f" />
            <text x={padL - 4} y={yFor(v) + 3} fontSize="9" textAnchor="end" fill="#6e6e6e">{(v * 100).toFixed(1)}%</text>
          </g>
        ))}
        {/* underlying spot reference */}
        <line x1={xFor(underlying)} y1={padT} x2={xFor(underlying)} y2={H - padB} stroke="#3a3a3a" strokeDasharray="3,3" />
        <text x={xFor(underlying)} y={padT - 4} fontSize="9" textAnchor="middle" fill="#6e6e6e">SPOT</text>

        <polyline fill="none" stroke="#22ee22" strokeWidth="1.5" points={callPath} />
        <polyline fill="none" stroke="#ff3b3b" strokeWidth="1.5" points={putPath} />

        {skew.best25Call && (
          <circle cx={xFor(skew.best25Call.strike)} cy={yFor(skew.best25Call.iv)} r="4" fill="#22ee22" stroke="#0a0a0a" strokeWidth="1" />
        )}
        {skew.best25Put && (
          <circle cx={xFor(skew.best25Put.strike)} cy={yFor(skew.best25Put.iv)} r="4" fill="#ff3b3b" stroke="#0a0a0a" strokeWidth="1" />
        )}
      </svg>
      <div className="absolute top-2 right-3 text-[10px] uppercase tracking-widest text-term-muted flex items-center gap-3">
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-term-green" />CALLS</span>
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-term-red" />PUTS</span>
        <span>DOTS = ~25Δ</span>
      </div>
    </div>
  );
}
