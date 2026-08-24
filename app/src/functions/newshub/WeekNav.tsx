import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { DAY_LABELS } from "@/lib/weekview";

export interface DayCount { date: string; total: number; highlight: number }

interface Props {
  weekLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  days: DayCount[];
  highlightLabel: string;
  selected: string | "all";
  onSelect: (d: string | "all") => void;
}

/** Shared Mon–Fri week-nav strip for Econ Calendar / Earnings: prev/next
 * week arrows, a day picker with per-day totals + a highlighted subcount
 * (high-impact / mega-cap), and an "All week" toggle. */
export function WeekNav({ weekLabel, onPrev, onNext, onToday, days, highlightLabel, selected, onSelect }: Props) {
  return (
    <div className="flex items-center gap-2 h-9 px-2 border-b border-term-border bg-term-panel2 text-[11px] overflow-x-auto scroll-thin">
      <button onClick={onPrev} className="text-term-muted hover:text-term-amber shrink-0" title="Previous week">
        <ChevronLeft size={14} />
      </button>
      <button onClick={onToday} className="text-term-muted hover:text-term-amber uppercase tracking-widest text-[10px] shrink-0" title="This week">
        {weekLabel}
      </button>
      <button onClick={onNext} className="text-term-muted hover:text-term-amber shrink-0" title="Next week">
        <ChevronRight size={14} />
      </button>
      <div className="w-px h-5 bg-term-border mx-1 shrink-0" />
      <button
        onClick={() => onSelect("all")}
        className={cn("px-2 py-1 border shrink-0", selected === "all" ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}
      >
        ALL WEEK
      </button>
      {days.map((d, i) => (
        <button
          key={d.date}
          onClick={() => onSelect(d.date)}
          className={cn(
            "px-2 py-1 border flex flex-col items-center min-w-[64px] shrink-0",
            selected === d.date ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text"
          )}
        >
          <span className="uppercase tracking-widest text-[9px]">{DAY_LABELS[i]}</span>
          <span className="num text-term-heading">{d.total}</span>
          {d.highlight > 0 && <span className="num text-[9px] text-term-red">{d.highlight} {highlightLabel}</span>}
        </button>
      ))}
    </div>
  );
}
