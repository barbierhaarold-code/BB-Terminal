import type { Trade } from "@/lib/journal";
import { computeStats, mask } from "@/lib/journal";
import { useJournal } from "@/store/journalStore";
import { fmtPrice, fmtPct, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

type Tone = "up" | "down" | "neutral";

function Metric({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="px-2 py-1.5 border border-term-borderSoft">
      <div className="sub-header">{label}</div>
      <div className={cn("num text-[16px] mt-0.5", tone === "up" && "up", tone === "down" && "down")}>{value}</div>
    </div>
  );
}

/** A $ figure with an optional secondary figure alongside it. The $ part
 * always masks when prices are hidden; the caller decides whether `pct` is
 * pre-masked too (avg win/loss % stay visible — a rate isn't a dollar
 * amount — but the capital-relative drawdown %s mask along with their $,
 * since they're the figures this toggle exists to hide). */
function DualMetric({ label, dollar, pct, tone, hidden }: {
  label: string; dollar: string; pct?: string; tone?: Tone; hidden: boolean;
}) {
  return (
    <div className="px-2 py-1.5 border border-term-borderSoft">
      <div className="sub-header">{label}</div>
      <div className={cn("num text-[16px] mt-0.5", tone === "up" && "up", tone === "down" && "down")}>
        {mask(dollar, hidden)}
        {pct != null && <span className="text-[12px] text-term-muted ml-1.5">({pct})</span>}
      </div>
    </div>
  );
}

function toneOf(v: number | undefined): Tone {
  if (v == null || v === 0) return "neutral";
  return v > 0 ? "up" : "down";
}

function signed(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : ""}${fmtPrice(v, digits)}`;
}

function EquityCurve({ points }: { points: { date: string; equity: number }[] }) {
  if (points.length < 2) {
    return <div className="p-4 text-term-muted text-[11px] uppercase tracking-widest">Not enough trades for a curve yet.</div>;
  }
  const values = points.map((p) => p.equity);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1;
  const w = 100, h = 36;
  const pts = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p.equity - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  const zeroY = h - ((0 - min) / range) * h;
  const last = values[values.length - 1];
  const stroke = last >= 0 ? "#22ee22" : "#ff3b3b";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
      <polyline fill="none" stroke={stroke} strokeWidth="1" points={pts} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatsPanel({ trades }: { trades: Trade[] }) {
  const { baseCapital, pricesHidden } = useJournal();
  const s = computeStats(trades, baseCapital);
  const h = pricesHidden;

  if (s.count === 0) {
    return (
      <div className="panel">
        <div className="panel-header"><span>PERFORMANCE</span></div>
        <div className="p-4 text-term-muted text-[11px] uppercase tracking-widest">No trades in view.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>PERFORMANCE</span>
        <span className="sub-header normal-case tracking-normal font-normal">
          {s.count} trades in view · avg hold {s.avgDurationMs != null ? fmtDuration(s.avgDurationMs) : "—"} · {s.tradesPerWeek.toFixed(1)}/wk
        </span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Metric label="WIN RATE" value={fmtPct(s.winRate, 1)} tone={toneOf(s.winRate - 50)} />
          <Metric label="PROFIT FACTOR" value={s.profitFactor != null ? s.profitFactor.toFixed(2) : "—"} tone={toneOf(s.profitFactor != null ? s.profitFactor - 1 : undefined)} />
          <Metric label="RETURN" value={fmtPct(s.returnPct, 2)} tone={toneOf(s.returnPct)} />
          <Metric label="CALMAR (RETURN% / MAXDD%)" value={s.calmar != null ? s.calmar.toFixed(2) : "—"} tone={toneOf(s.calmar)} />

          <DualMetric label="NET P&L" dollar={signed(s.netProfit)} tone={toneOf(s.netProfit)} hidden={h} />
          <DualMetric label="EXPECTANCY / TRADE" dollar={signed(s.expectancy)} tone={toneOf(s.expectancy)} hidden={h} />
          <DualMetric label="MAX DRAWDOWN" dollar={fmtPrice(s.maxDrawdown, 2)} pct={fmtPct(s.maxDrawdownPct, 2)} tone={s.maxDrawdown > 0 ? "down" : "neutral"} hidden={h} />
          <DualMetric label="CURRENT DRAWDOWN" dollar={fmtPrice(s.currentDrawdown, 2)} pct={`vs max ${fmtPct(s.maxDrawdownPct, 2)}`} tone={s.currentDrawdown > 0 ? "down" : "neutral"} hidden={h} />

          <DualMetric label="AVG WIN" dollar={signed(s.avgWin)} pct={fmtPct(s.avgWinPct, 2)} tone="up" hidden={h} />
          <DualMetric label="AVG LOSS" dollar={signed(s.avgLoss)} pct={fmtPct(s.avgLossPct, 2)} tone="down" hidden={h} />
          <Metric label="LONGEST WIN / LOSS STREAK" value={`${s.longestWinStreak} / ${s.longestLossStreak}`} />
          <Metric label="RISK / TRADE (NOTIONAL, EST.)" value={s.riskPerTradePct != null ? fmtPct(s.riskPerTradePct, 2) : "—"} />

          <Metric label="RECOVERY FACTOR" value={s.recoveryFactor != null ? s.recoveryFactor.toFixed(2) : "—"} />
          <Metric label="SHARPE (PER-TRADE)" value={s.sharpe != null ? s.sharpe.toFixed(2) : "—"} tone={toneOf(s.sharpe)} />
          <Metric label="DEPOSIT LOAD (AVG NOTIONAL, EST.)" value={s.depositLoadPct != null ? fmtPct(s.depositLoadPct, 2) : "—"} />
          <DualMetric label="GROSS P / L" dollar={`${fmtPrice(s.grossProfit, 0)} / ${fmtPrice(s.grossLoss, 0)}`} hidden={h} />
        </div>

        <div>
          <div className="sub-header mb-1">EQUITY CURVE</div>
          <EquityCurve points={s.equityCurve} />
        </div>

        <div>
          <div className="sub-header mb-1">{s.periodGranularity === "week" ? "WEEKLY" : "MONTHLY"} P&amp;L</div>
          <div className="border border-term-borderSoft p-2 flex flex-col gap-0.5">
            {s.byPeriod.map((p) => (
              <div key={p.label} className="flex items-center justify-between text-[11px] py-0.5">
                <span className="text-term-text">{p.label} <span className="text-term-muted">({p.count})</span></span>
                <span className={cn("num", toneOf(p.net) === "up" && "up", toneOf(p.net) === "down" && "down")}>
                  {mask(signed(p.net, 0), h)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="border border-term-borderSoft p-2">
            <div className="sub-header mb-1">BY DIRECTION</div>
            {(["buy", "sell"] as const).map((d) => (
              <div key={d} className="flex items-center justify-between text-[11px] py-0.5">
                <span className={cn("uppercase", d === "buy" ? "text-term-green" : "text-term-red")}>{d} ({s.byDirection[d].count})</span>
                <span className="num text-term-muted">{fmtPct(s.byDirection[d].winRate, 0)}</span>
                <span className={cn("num", toneOf(s.byDirection[d].net) === "up" && "up", toneOf(s.byDirection[d].net) === "down" && "down")}>
                  {mask(signed(s.byDirection[d].net, 0), h)}
                </span>
              </div>
            ))}
          </div>
          <div className="border border-term-borderSoft p-2">
            <div className="sub-header mb-1">BY DAY OF WEEK</div>
            {s.byWeekday.filter((w) => w.count > 0).map((w) => (
              <div key={w.day} className="flex items-center justify-between text-[11px] py-0.5">
                <span className="text-term-text">{w.day} ({w.count})</span>
                <span className="num text-term-muted">{fmtPct(w.winRate, 0)}</span>
                <span className={cn("num", toneOf(w.net) === "up" && "up", toneOf(w.net) === "down" && "down")}>
                  {mask(signed(w.net, 0), h)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {s.bestTrade && (
            <div className="border border-term-green/40 px-2 py-1.5">
              <div className="sub-header">BEST TRADE</div>
              <div className="flex items-center justify-between">
                <span className="text-term-text text-[11px]">{s.bestTrade.symbol} · {s.bestTrade.entryAt.slice(0, 10)}</span>
                <span className={cn("num", s.bestTrade.result >= 0 ? "up" : "down")}>{mask(signed(s.bestTrade.result), h)}</span>
              </div>
            </div>
          )}
          {s.worstTrade && (
            <div className="border border-term-red/40 px-2 py-1.5">
              <div className="sub-header">WORST TRADE</div>
              <div className="flex items-center justify-between">
                <span className="text-term-text text-[11px]">{s.worstTrade.symbol} · {s.worstTrade.entryAt.slice(0, 10)}</span>
                <span className="num down">{mask(fmtPrice(s.worstTrade.result, 2), h)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
