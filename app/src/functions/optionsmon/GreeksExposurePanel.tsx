import { useMemo, useState } from "react";
import type { OptionsRow } from "@/lib/api";
import { fmtVolume } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useOptionsChain } from "./useOptionsChain";
import { useRiskFreeRate } from "./useRiskFreeRate";
import { blackScholesGreeks, DAYS_PER_YEAR, CONTRACT_MULTIPLIER } from "@/lib/greeks";

type Metric = "gamma" | "delta" | "vanna" | "charm";
const METRICS: { id: Metric; label: string }[] = [
  { id: "gamma", label: "GAMMA (GEX)" },
  { id: "delta", label: "DELTA (DEX)" },
  { id: "vanna", label: "VANNA" },
  { id: "charm", label: "CHARM" },
];

const NEAR_TERM_MAX_DTE = 45;
const SCENARIO_STEPS = 60;
const SCENARIO_RANGE = 0.15; // ±15% around spot
const CHART_DISPLAY_WINDOW = 0.4; // ±40% around spot — keeps the bar chart legible when a few thin far-OTM strikes are in the near-term chain

/** Net gamma exposure at a hypothetical spot, calls +, puts − (standard public GEX convention). */
function totalGexAt(rows: OptionsRow[], S: number, r: number): number {
  let total = 0;
  for (const row of rows) {
    if (row.implied_volatility == null || row.open_interest == null) continue;
    const T = Math.max(row.dte, 1) / DAYS_PER_YEAR;
    const gamma = blackScholesGreeks(S, row.strike, T, r, row.implied_volatility, row.option_type).gamma;
    const value = gamma * row.open_interest * CONTRACT_MULTIPLIER * S * S * 0.01;
    total += row.option_type === "call" ? value : -value;
  }
  return total;
}

function findZeroGammaFlip(rows: OptionsRow[], spot: number, r: number): number | null {
  const lo = spot * (1 - SCENARIO_RANGE), hi = spot * (1 + SCENARIO_RANGE);
  let prevS = lo, prevVal = totalGexAt(rows, lo, r);
  for (let i = 1; i <= SCENARIO_STEPS; i++) {
    const s = lo + (hi - lo) * (i / SCENARIO_STEPS);
    const val = totalGexAt(rows, s, r);
    if ((prevVal <= 0 && val > 0) || (prevVal >= 0 && val < 0)) {
      const frac = prevVal / (prevVal - val);
      return prevS + (s - prevS) * frac;
    }
    prevS = s; prevVal = val;
  }
  return null;
}

function contractExposure(row: OptionsRow, S: number, r: number, metric: Metric): number {
  if (row.implied_volatility == null || row.open_interest == null) return 0;
  const T = Math.max(row.dte, 1) / DAYS_PER_YEAR;
  const g = blackScholesGreeks(S, row.strike, T, r, row.implied_volatility, row.option_type);
  const oi = row.open_interest;
  if (metric === "gamma") {
    const v = g.gamma * oi * CONTRACT_MULTIPLIER * S * S * 0.01;
    return row.option_type === "call" ? v : -v;
  }
  if (metric === "delta") return g.delta * oi * CONTRACT_MULTIPLIER * S;
  if (metric === "vanna") return g.vanna * oi * CONTRACT_MULTIPLIER * S;
  return g.charm * oi * CONTRACT_MULTIPLIER * S; // charm
}

export function GreeksExposurePanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error, underlying } = useOptionsChain(symbol);
  const riskFreeRate = useRiskFreeRate();
  const [metric, setMetric] = useState<Metric>("gamma");

  const nearTermRows = useMemo(() => {
    const near = data.filter((r) => r.dte <= NEAR_TERM_MAX_DTE);
    return near.length > 0 ? near : data;
  }, [data]);

  const byStrike = useMemo(() => {
    if (!underlying) return [];
    const m = new Map<number, number>();
    for (const r of nearTermRows) {
      m.set(r.strike, (m.get(r.strike) ?? 0) + contractExposure(r, underlying, riskFreeRate, metric));
    }
    return Array.from(m.entries())
      .map(([strike, value]) => ({ strike, value }))
      .sort((a, b) => a.strike - b.strike);
  }, [nearTermRows, underlying, riskFreeRate, metric]);

  const netTotal = byStrike.reduce((s, r) => s + r.value, 0);

  const chartRows = useMemo(() => {
    if (!underlying) return byStrike;
    const lo = underlying * (1 - CHART_DISPLAY_WINDOW), hi = underlying * (1 + CHART_DISPLAY_WINDOW);
    const windowed = byStrike.filter((r) => r.strike >= lo && r.strike <= hi);
    return windowed.length > 0 ? windowed : byStrike;
  }, [byStrike, underlying]);

  const flipPoint = useMemo(() => {
    if (!underlying || nearTermRows.length === 0) return null;
    return findZeroGammaFlip(nearTermRows, underlying, riskFreeRate);
  }, [nearTermRows, underlying, riskFreeRate]);

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading Greeks exposure…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (byStrike.length === 0) {
    return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">No chain data available to compute exposure.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-auto scroll-thin">
      <div className="px-3 py-2 border-b border-term-border bg-term-panel2 text-[10.5px] text-term-muted leading-relaxed">
        OI-based exposure estimate — a standard public approximation (calls contribute positive gamma, puts negative),
        <span className="text-term-amber"> not confirmed dealer positioning</span>. Near-term contracts only (≤{NEAR_TERM_MAX_DTE} DTE).
      </div>
      <div className="flex items-center gap-4 px-3 h-9 border-b border-term-border flex-wrap">
        <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider">
          {METRICS.map((m) => (
            <button key={m.id} onClick={() => setMetric(m.id)}
              className={cn("px-2 py-0.5 border",
                m.id === metric ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4 text-[11px] uppercase tracking-wider shrink-0">
          <span className="flex items-baseline gap-2">
            <span className="text-term-muted">NET {metric.toUpperCase()}</span>
            <span className={cn("num font-bold", netTotal >= 0 ? "up" : "down")}>${fmtVolume(netTotal)}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-term-muted">ZERO-GAMMA FLIP</span>
            <span className="text-term-amber num font-bold">{flipPoint != null ? flipPoint.toFixed(2) : "—"}</span>
          </span>
        </div>
      </div>
      <div className="p-3 border-b border-term-border">
        <ExposureBarChart rows={chartRows} underlying={underlying} flipPoint={metric === "gamma" ? flipPoint : null} />
      </div>
    </div>
  );
}

function ExposureBarChart({ rows, underlying, flipPoint }: {
  rows: { strike: number; value: number }[]; underlying: number | undefined; flipPoint: number | null;
}) {
  const W = 800, H = 220, padL = 50, padR = 16, padT = 12, padB = 22;
  const midY = padT + (H - padT - padB) / 2;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const barW = Math.max((W - padL - padR) / rows.length - 2, 1);
  const xFor = (i: number) => padL + i * ((W - padL - padR) / rows.length);
  const hFor = (v: number) => (Math.abs(v) / maxAbs) * (midY - padT);
  const minK = rows[0]?.strike ?? 0;
  const maxK = rows[rows.length - 1]?.strike ?? 1;
  const xForStrike = (k: number) => padL + ((k - minK) / (maxK - minK || 1)) * (W - padL - padR);

  return (
    <div className="relative border border-term-border bg-term-bg2 min-h-[220px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke="#2a2a2a" />
        {rows.map((r, i) => (
          <rect key={r.strike}
            x={xFor(i)} y={r.value >= 0 ? midY - hFor(r.value) : midY}
            width={barW} height={hFor(r.value)}
            fill={r.value >= 0 ? "#22ee22" : "#ff3b3b"} opacity={0.8} />
        ))}
        {underlying != null && (
          <line x1={xForStrike(underlying)} y1={padT} x2={xForStrike(underlying)} y2={H - padB} stroke="#b45cff" strokeDasharray="3,3" />
        )}
        {flipPoint != null && (
          <line x1={xForStrike(flipPoint)} y1={padT} x2={xForStrike(flipPoint)} y2={H - padB} stroke="#ffaa33" strokeWidth="1.5" />
        )}
        {rows.filter((_, i) => i % Math.ceil(rows.length / 12 || 1) === 0).map((r) => {
          const i = rows.indexOf(r);
          return <text key={r.strike} x={xFor(i) + barW / 2} y={H - padB + 12} fontSize="9" textAnchor="middle" fill="#6e6e6e">{r.strike}</text>;
        })}
      </svg>
      <div className="absolute top-2 right-3 text-[10px] uppercase tracking-widest text-term-muted flex items-center gap-3">
        <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-term-amber" />SPOT</span>
        {flipPoint != null && <span className="flex items-center gap-1"><span className="w-2 h-0.5" style={{ background: "#ffaa33" }} />FLIP</span>}
      </div>
    </div>
  );
}
