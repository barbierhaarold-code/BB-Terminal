import { useEffect, useMemo } from "react";
import { fmtVolume, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useOptionsChain } from "./useOptionsChain";
import { useOiSnapshotStore } from "./oiSnapshotStore";

const VOL_OI_THRESHOLD = 0.5;
const OI_JUMP_MIN_ABS = 200; // ignore noise on thin contracts
const OI_JUMP_MIN_PCT = 0.3;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function UnusualActivityPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useOptionsChain(symbol);
  const save = useOiSnapshotStore((s) => s.save);

  // Capture the snapshot that existed *before* this render's save, so the
  // diff below compares against a genuinely prior day, not today-vs-today.
  const prior = useMemo(
    () => useOiSnapshotStore.getState().snapshots[symbol],
    [symbol]
  );

  useEffect(() => {
    if (data.length === 0) return;
    const today = todayStr();
    if (prior?.date === today) return;
    const byContract: Record<string, number> = {};
    for (const r of data) byContract[r.contract_symbol] = r.open_interest ?? 0;
    save(symbol, { date: today, byContract });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, symbol]);

  const volOiFlags = useMemo(() => {
    return data
      .filter((r) => r.volume != null && r.open_interest != null && r.open_interest > 0)
      .map((r) => ({ ...r, ratio: (r.volume as number) / (r.open_interest as number) }))
      .filter((r) => r.ratio > VOL_OI_THRESHOLD)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 40);
  }, [data]);

  const oiJumpFlags = useMemo(() => {
    if (!prior || prior.date === todayStr() || data.length === 0) return [];
    return data
      .filter((r) => r.open_interest != null)
      .map((r) => {
        const priorOi = prior.byContract[r.contract_symbol];
        if (priorOi == null) return null;
        const delta = (r.open_interest as number) - priorOi;
        const pct = priorOi > 0 ? delta / priorOi : delta > 0 ? Infinity : 0;
        return { ...r, priorOi, delta, pct };
      })
      .filter((r): r is NonNullable<typeof r> => r != null && Math.abs(r.delta) >= OI_JUMP_MIN_ABS && Math.abs(r.pct) >= OI_JUMP_MIN_PCT)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 40);
  }, [data, prior]);

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading unusual activity…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;

  return (
    <div className="h-full flex flex-col overflow-auto scroll-thin">
      <div className="px-3 py-2 border-b border-term-border bg-term-panel2 text-[10.5px] text-term-muted leading-relaxed">
        EOD volume-vs-OI proxy — <span className="text-term-amber">not real-time flow</span>. Catching large prints
        as they happen needs a paid feed (Polygon options trades, ORATS). Day-over-day OI jumps are diffed against
        the last time this symbol's chain was viewed on a prior day, cached locally — not a continuous history.
      </div>

      <div className="p-3 border-b border-term-border">
        <div className="sub-header mb-2">VOLUME &gt; {(VOL_OI_THRESHOLD * 100).toFixed(0)}% OF OPEN INTEREST</div>
        {volOiFlags.length === 0 ? (
          <div className="text-term-muted text-[11px] uppercase tracking-widest">No contracts crossed the threshold today.</div>
        ) : (
          <UaTable rows={volOiFlags.map((r) => ({
            key: r.contract_symbol, expiration: r.expiration, strike: r.strike, type: r.option_type,
            main: fmtVolume(r.volume), sub: fmtVolume(r.open_interest), extra: `${r.ratio.toFixed(2)}x`,
          }))} mainLabel="VOL" subLabel="OI" extraLabel="VOL/OI" />
        )}
      </div>

      <div className="p-3 flex-1">
        <div className="sub-header mb-2">OPEN INTEREST — DAY-OVER-DAY JUMP</div>
        {prior == null ? (
          <div className="text-term-muted text-[11px] uppercase tracking-widest">
            No prior-day snapshot yet for {symbol} — comes back once this chain has been viewed on two different days.
          </div>
        ) : prior.date === todayStr() ? (
          <div className="text-term-muted text-[11px] uppercase tracking-widest">Already snapshotted today ({fmtDate(prior.date)}) — check back tomorrow.</div>
        ) : oiJumpFlags.length === 0 ? (
          <div className="text-term-muted text-[11px] uppercase tracking-widest">No large OI jumps since {fmtDate(prior.date)}.</div>
        ) : (
          <UaTable rows={oiJumpFlags.map((r) => ({
            key: r.contract_symbol, expiration: r.expiration, strike: r.strike, type: r.option_type,
            main: fmtVolume(r.open_interest), sub: fmtVolume(r.priorOi),
            extra: `${r.delta >= 0 ? "+" : ""}${fmtVolume(r.delta)} (${(r.pct * 100).toFixed(0)}%)`,
          }))} mainLabel="OI TODAY" subLabel={`OI ${fmtDate(prior.date)}`} extraLabel="Δ" />
        )}
      </div>
    </div>
  );
}

function UaTable({ rows, mainLabel, subLabel, extraLabel }: {
  rows: { key: string; expiration: string; strike: number; type: "call" | "put"; main: string; sub: string; extra: string }[];
  mainLabel: string; subLabel: string; extraLabel: string;
}) {
  return (
    <table className="w-full text-[11.5px] grid-data">
      <thead>
        <tr>
          <th className="text-left">EXP</th>
          <th className="text-right">STRIKE</th>
          <th className="text-center">TYPE</th>
          <th className="text-right">{mainLabel}</th>
          <th className="text-right">{subLabel}</th>
          <th className="text-right">{extraLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="text-left text-term-muted">{r.expiration}</td>
            <td className="num text-right text-term-heading">{r.strike}</td>
            <td className={cn("text-center", r.type === "call" ? "up" : "down")}>{r.type.toUpperCase()}</td>
            <td className="num text-right text-term-text">{r.main}</td>
            <td className="num text-right text-term-muted">{r.sub}</td>
            <td className="num text-right text-term-amber font-bold">{r.extra}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
