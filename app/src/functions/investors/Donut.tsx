import { cn } from "@/lib/cn";

/** Cycles through the existing term-* token family — no new colors introduced. */
const SLICE_CLASSES = [
  "stroke-term-amber", "stroke-term-cyan", "stroke-term-green", "stroke-term-red",
  "stroke-term-amberBright", "stroke-term-greenDim", "stroke-term-redDim", "stroke-term-amberDim",
  "stroke-term-muted", "stroke-term-text",
];

export interface DonutSlice { label: string; value: number }

/** Simple SVG donut with a matching legend — used for the Funds tab's
 * sector-allocation breakdown. No charting dependency; the app has no other
 * donut/pie need yet, so a small self-contained component beats a new lib. */
export function Donut({ data, size = 160 }: { data: DonutSlice[]; size?: number }) {
  const total = data.reduce((a, d) => a + Math.max(d.value, 0), 0);
  if (total <= 0) return <div className="text-term-muted text-[11px]">No data.</div>;

  const r = size / 2;
  const stroke = r * 0.38;
  const radius = r - stroke / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = data.map((d, i) => {
    const pct = Math.max(d.value, 0) / total;
    const dash = pct * circumference;
    const arc = (
      <circle
        key={i}
        cx={r} cy={r} r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        className={SLICE_CLASSES[i % SLICE_CLASSES.length]}
        transform={`rotate(-90 ${r} ${r})`}
      />
    );
    offset += dash;
    return arc;
  });

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{arcs}</svg>
      <div className="flex flex-col gap-1 text-[11px]">
        {data.map((d, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 shrink-0", SLICE_CLASSES[i % SLICE_CLASSES.length].replace("stroke-", "bg-"))} />
            <span className="text-term-muted truncate max-w-[140px]">{d.label}</span>
            <span className="num text-term-text">{((Math.max(d.value, 0) / total) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
