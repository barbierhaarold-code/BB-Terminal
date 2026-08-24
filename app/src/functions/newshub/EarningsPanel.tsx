import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { fetchEarningsCalendar } from "@/lib/api";
import { fmtVolume } from "@/lib/format";
import { addWeeks, weekLabel, weekRange } from "@/lib/weekview";
import { cn } from "@/lib/cn";
import { WeekNav, type DayCount } from "./WeekNav";

const MEGA_CAP = 200e9;
type TimeFilter = "all" | "pre-market" | "after-hours";
const TIME_LABEL: Record<string, string> = { "pre-market": "BMO", "after-hours": "AMC", "not-supplied": "—" };

export function EarningsPanel() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | "all">("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [q, setQ] = useState("");

  const week = useMemo(() => weekRange(addWeeks(new Date(), weekOffset)), [weekOffset]);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["newshub-earnings", week.monday, week.friday],
    queryFn: () => fetchEarningsCalendar(week.monday, week.friday),
    staleTime: 5 * 60_000,
  });

  const dayCounts: DayCount[] = week.days.map((date) => {
    const onDay = data.filter((r) => r.report_date === date);
    return { date, total: onDay.length, highlight: onDay.filter((r) => (r.market_cap ?? 0) >= MEGA_CAP).length };
  });

  const filtered = data.filter((r) => {
    if (selectedDay !== "all" && r.report_date !== selectedDay) return false;
    if (timeFilter !== "all" && r.reporting_time !== timeFilter) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      if (!r.symbol.toLowerCase().includes(needle) && !(r.name ?? "").toLowerCase().includes(needle)) return false;
    }
    return true;
  }).sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0));

  return (
    <div className="h-full flex flex-col min-h-0">
      <WeekNav
        weekLabel={weekLabel(week.days)}
        onPrev={() => setWeekOffset((w) => w - 1)}
        onNext={() => setWeekOffset((w) => w + 1)}
        onToday={() => setWeekOffset(0)}
        days={dayCounts}
        highlightLabel="MEGA"
        selected={selectedDay}
        onSelect={setSelectedDay}
      />
      <div className="flex items-center gap-2 h-8 px-2 border-b border-term-border bg-term-panel2 text-[11px]">
        <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as TimeFilter)} className="bg-term-panel border border-term-border px-1.5 py-0.5 text-[11px]">
          <option value="all">Before/after</option>
          <option value="pre-market">Before open</option>
          <option value="after-hours">After close</option>
        </select>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 max-w-xs">
          <Search size={11} className="text-term-muted shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter by symbol / company…"
            className="flex-1 min-w-0 bg-transparent text-[11px] placeholder:text-term-muted focus:outline-none"
          />
        </div>
        <span className="sub-header ml-auto">{filtered.length} REPORTS · {MEGA_CAP / 1e9}B+ = MEGA</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {isLoading && <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
        {error && <div className="p-4 text-term-red">{(error as Error).message}</div>}
        {!isLoading && !error && filtered.length === 0 && <div className="p-4 text-term-muted">No earnings match these filters.</div>}
        {!isLoading && !error && filtered.length > 0 && (
          <table className="grid-data w-full text-[11px]">
            <thead>
              <tr>
                <th>Date</th><th>Time</th><th>Symbol</th><th>Company</th>
                <th className="text-right">Market Cap</th>
                <th className="text-right">EPS Est.</th><th className="text-right">EPS Prev.</th>
                <th className="text-right"># Est.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.symbol + r.report_date + i}>
                  <td className="num text-term-muted whitespace-nowrap">{r.report_date}</td>
                  <td>
                    <span className={cn(
                      "text-[10px] tracking-wider px-1 border",
                      r.reporting_time === "pre-market" ? "border-term-green/50 text-term-green"
                        : r.reporting_time === "after-hours" ? "border-term-cyan/50 text-term-cyan"
                        : "border-term-border text-term-muted"
                    )}>
                      {TIME_LABEL[r.reporting_time ?? ""] ?? "—"}
                    </span>
                  </td>
                  <td className="text-term-heading font-bold">{r.symbol}</td>
                  <td className="text-term-muted truncate max-w-[220px]">{r.name}</td>
                  <td className="num text-right">{r.market_cap != null ? fmtVolume(r.market_cap) : "—"}</td>
                  <td className="num text-right">{r.eps_consensus != null ? r.eps_consensus.toFixed(2) : "—"}</td>
                  <td className="num text-right text-term-muted">{r.eps_previous != null ? r.eps_previous.toFixed(2) : "—"}</td>
                  <td className="num text-right text-term-muted">{r.num_estimates ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="sub-header px-2 py-1 border-t border-term-borderSoft shrink-0">
        NASDAQ'S FREE CALENDAR DOESN'T CARRY INDEX/SECTOR/INDUSTRY OR LIVE PRICE/P/E — SYMBOL SEARCH AND
        BEFORE/AFTER FILTERS STAND IN. ACTUAL EPS + SURPRISE APPEAR ONLY ONCE A REPORT IS OUT.
      </div>
    </div>
  );
}
