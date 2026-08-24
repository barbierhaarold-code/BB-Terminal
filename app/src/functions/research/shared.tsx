import { cn } from "@/lib/cn";

export { Loading, ErrorBlock } from "@/functions/DES";

export function EmptyBlock({ children }: { children: React.ReactNode }) {
  return <div className="p-4 text-term-muted text-[11px] uppercase tracking-widest">{children}</div>;
}

export function GapNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-term-borderSoft bg-term-panel2 px-3 py-2 text-[11px] text-term-muted leading-relaxed">
      <span className="text-term-amber font-semibold mr-1">DATA GAP —</span>{children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-term-amber text-[10px] tracking-[0.25em] font-bold border-b border-term-border pb-1 mb-2">{children}</div>;
}

/** Simple vertical bar trend, oldest → newest left to right. Values may be negative. */
export function BarTrend({
  data, fmt, height = 64, color = "bg-term-amber/70",
}: { data: { label: string; value: number }[]; fmt: (v: number) => string; height?: number; color?: string }) {
  if (data.length === 0) return <div className="text-term-muted text-[11px]">No data.</div>;
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const zeroPct = (max / range) * 100;
  return (
    <div className="flex items-stretch gap-1.5" style={{ height }}>
      {data.map((d, i) => {
        const topPct = ((max - Math.max(d.value, 0)) / range) * 100;
        const barPct = (Math.abs(d.value) / range) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center min-w-0" title={`${d.label}: ${fmt(d.value)}`}>
            <div className="relative w-full flex-1">
              <div
                className={cn("absolute w-full", d.value >= 0 ? color : "bg-term-red/70")}
                style={{ top: `${d.value >= 0 ? topPct : zeroPct}%`, height: `${barPct}%`, minHeight: d.value !== 0 ? 2 : 0 }}
              />
            </div>
            <div className="sub-header mt-1 truncate w-full text-center">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A single-row proportional stacked bar (e.g. assets composition, ownership split). */
export function ProportionBar({
  segments,
}: { segments: { label: string; value: number; className: string }[] }) {
  const total = segments.reduce((a, s) => a + Math.max(s.value, 0), 0);
  if (total <= 0) return <div className="text-term-muted text-[11px]">No data.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-5 w-full overflow-hidden border border-term-border">
        {segments.map((s, i) => {
          const pct = (Math.max(s.value, 0) / total) * 100;
          if (pct <= 0) return null;
          return <div key={i} className={s.className} style={{ width: `${pct}%` }} title={`${s.label}: ${pct.toFixed(1)}%`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {segments.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 shrink-0", s.className)} />
            <span className="text-term-muted">{s.label}</span>
            <span className="num text-term-text">{((Math.max(s.value, 0) / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export interface WaterfallStep { label: string; value: number; kind: "start" | "delta" | "total"; }

/** Revenue → … → Net Income style waterfall, running total shown as connected bars. */
export function Waterfall({ steps, fmt }: { steps: WaterfallStep[]; fmt: (v: number) => string }) {
  let running = 0;
  const bars = steps.map((s) => {
    if (s.kind === "delta") {
      const from = running;
      running += s.value;
      return { ...s, from, to: running };
    }
    running = s.value;
    return { ...s, from: 0, to: running };
  });
  const max = Math.max(...bars.map((b) => Math.max(b.from, b.to)), 0);
  const min = Math.min(...bars.map((b) => Math.min(b.from, b.to)), 0);
  const range = max - min || 1;
  const pct = (v: number) => ((max - v) / range) * 100;

  return (
    <div className="flex items-end gap-2" style={{ height: 200 }}>
      {bars.map((b, i) => {
        const top = pct(Math.max(b.from, b.to));
        const bottom = pct(Math.min(b.from, b.to));
        const h = Math.max(bottom - top, 0.5);
        const color = b.kind === "total" ? "bg-term-amber" : b.value >= 0 ? "bg-term-green/70" : "bg-term-red/70";
        return (
          <div key={i} className="flex-1 flex flex-col items-center h-full min-w-0">
            <div className="relative w-full flex-1">
              <div className={cn("absolute w-full", color)} style={{ top: `${top}%`, height: `${h}%` }} title={`${b.label}: ${fmt(b.value)}`} />
            </div>
            <div className="sub-header mt-1 truncate w-full text-center">{b.label}</div>
            <div className="num text-[10px] text-term-text truncate w-full text-center">{fmt(b.kind === "delta" ? b.value : b.to)}</div>
          </div>
        );
      })}
    </div>
  );
}
