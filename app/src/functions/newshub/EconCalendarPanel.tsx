import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEconCalendar } from "@/lib/api";
import { estimateImpact, surprise, type Impact } from "@/lib/econCalendar";
import { addWeeks, weekLabel, weekRange } from "@/lib/weekview";
import { cn } from "@/lib/cn";
import { WeekNav, type DayCount } from "./WeekNav";

const IMPACT_DOT: Record<Impact, string> = { high: "bg-term-red", medium: "bg-term-amber", low: "bg-term-muted" };
const IMPACT_LABEL: Record<Impact, string> = { high: "HIGH", medium: "MED", low: "LOW" };

export function EconCalendarPanel() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | "all">("all");
  const [country, setCountry] = useState("all");
  const [impact, setImpact] = useState<Impact | "all">("all");

  const week = useMemo(() => weekRange(addWeeks(new Date(), weekOffset)), [weekOffset]);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["newshub-econ-calendar", week.monday, week.friday],
    queryFn: () => fetchEconCalendar(week.monday, week.friday),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(
    () => data.map((ev) => ({ ...ev, impact: estimateImpact(ev), surprise: surprise(ev.actual, ev.consensus) })),
    [data]
  );

  const countries = useMemo(() => Array.from(new Set(data.map((d) => d.country))).sort(), [data]);

  const dayCounts: DayCount[] = week.days.map((date) => {
    const onDay = rows.filter((r) => r.date.slice(0, 10) === date);
    return { date, total: onDay.length, highlight: onDay.filter((r) => r.impact === "high").length };
  });

  const filtered = rows.filter((r) => {
    if (selectedDay !== "all" && r.date.slice(0, 10) !== selectedDay) return false;
    if (country !== "all" && r.country !== country) return false;
    if (impact !== "all" && r.impact !== impact) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col min-h-0">
      <WeekNav
        weekLabel={weekLabel(week.days)}
        onPrev={() => setWeekOffset((w) => w - 1)}
        onNext={() => setWeekOffset((w) => w + 1)}
        onToday={() => setWeekOffset(0)}
        days={dayCounts}
        highlightLabel="HIGH"
        selected={selectedDay}
        onSelect={setSelectedDay}
      />
      <div className="flex items-center gap-3 h-8 px-2 border-b border-term-border bg-term-panel2 text-[11px]">
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="bg-term-panel border border-term-border px-1.5 py-0.5 text-[11px]">
          <option value="all">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={impact} onChange={(e) => setImpact(e.target.value as Impact | "all")} className="bg-term-panel border border-term-border px-1.5 py-0.5 text-[11px]">
          <option value="all">All impact</option>
          <option value="high">High impact</option>
          <option value="medium">Med impact</option>
          <option value="low">Low impact</option>
        </select>
        <span className="sub-header ml-auto">{filtered.length} EVENTS</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {isLoading && <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
        {error && <div className="p-4 text-term-red">{(error as Error).message}</div>}
        {!isLoading && !error && filtered.length === 0 && <div className="p-4 text-term-muted">No events match these filters.</div>}
        {!isLoading && !error && filtered.length > 0 && (
          <table className="grid-data w-full text-[11px]">
            <thead>
              <tr>
                <th>Time</th><th>Country</th><th>Event</th>
                <th className="text-right">Actual</th><th className="text-right">Forecast</th>
                <th className="text-right">Previous</th><th className="text-right">Surprise</th><th>Impact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.date + r.event + i}>
                  <td className="num text-term-muted whitespace-nowrap">
                    {new Date(r.date).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="text-term-muted whitespace-nowrap">{r.country}</td>
                  <td className="text-term-heading">{r.event}</td>
                  <td className="num text-right">{r.actual?.trim() || "—"}</td>
                  <td className="num text-right text-term-muted">{r.consensus?.trim() || "—"}</td>
                  <td className="num text-right text-term-muted">{r.previous?.trim() || "—"}</td>
                  <td className={cn("num text-right", r.surprise == null ? "text-term-muted" : r.surprise >= 0 ? "up" : "down")}>
                    {r.surprise == null ? "—" : (r.surprise > 0 ? "+" : "") + r.surprise.toFixed(2)}
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", IMPACT_DOT[r.impact])} />
                      <span className="text-[10px] tracking-wider text-term-muted">{IMPACT_LABEL[r.impact]}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="sub-header px-2 py-1 border-t border-term-borderSoft shrink-0">
        IMPACT IS AN ESTIMATE (KEYWORD + ECONOMY-SIZE HEURISTIC) — NASDAQ'S FREE CALENDAR DOESN'T SHIP A LICENSED IMPACT
        RATING. PER-EVENT 15-PRINT SPARKLINES NEED AN INDICATOR-TO-SERIES MAPPING NOT YET BUILT — FLAGGED, NOT FAKED.
      </div>
    </div>
  );
}
