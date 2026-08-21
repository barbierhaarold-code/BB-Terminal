import { useMemo, useState } from "react";
import { useJournal } from "@/store/journalStore";
import { TradeForm } from "@/components/journal/TradeForm";
import { BulkImport } from "@/components/journal/BulkImport";
import { SetupsManager } from "@/components/journal/SetupsManager";
import { JournalSettings } from "@/components/journal/JournalSettings";
import { TradeTable } from "@/components/journal/TradeTable";
import { StatsPanel } from "@/components/journal/StatsPanel";
import { cn } from "@/lib/cn";

type EntryMode = "log" | "import";

export function TRACK() {
  const { trades, setups } = useJournal();
  const [mode, setMode] = useState<EntryMode>("log");

  const [setupFilter, setSetupFilter] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (setupFilter === "__none__" && t.setupId) return false;
      if (setupFilter && setupFilter !== "__none__" && t.setupId !== setupFilter) return false;
      if (symbolFilter && !t.symbol.toUpperCase().includes(symbolFilter.trim().toUpperCase())) return false;
      if (dateFrom && t.entryAt.slice(0, 10) < dateFrom) return false;
      if (dateTo && t.entryAt.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [trades, setupFilter, symbolFilter, dateFrom, dateTo]);

  const filterCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber text-[11px]";

  return (
    <div className="p-3 flex flex-col gap-3 text-[12px]">
      {/* Entry mode toggle */}
      <div className="flex gap-1">
        {(["log", "import"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={cn("px-3 py-1.5 border text-[11px] uppercase tracking-wider font-bold",
              m === mode ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text")}>
            {m === "log" ? "Log a Trade" : "Bulk Import"}
          </button>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(260px,280px)" }}>
        {mode === "log" ? <TradeForm /> : <BulkImport />}
        <div className="flex flex-col gap-3">
          <JournalSettings />
          <SetupsManager />
        </div>
      </div>

      {/* Filters */}
      <div className="panel">
        <div className="panel-header"><span>FILTERS</span></div>
        <div className="p-2 flex flex-wrap items-center gap-2">
          <select value={setupFilter} onChange={(e) => setSetupFilter(e.target.value)} className={filterCls}>
            <option value="">All setups</option>
            <option value="__none__">— unassigned —</option>
            {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} placeholder="SYMBOL…" spellCheck={false}
            className={cn(filterCls, "uppercase w-28")} />
          <span className="sub-header">FROM</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={cn(filterCls, "num")} />
          <span className="sub-header">TO</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={cn(filterCls, "num")} />
          {(setupFilter || symbolFilter || dateFrom || dateTo) && (
            <button onClick={() => { setSetupFilter(""); setSymbolFilter(""); setDateFrom(""); setDateTo(""); }}
              className="ml-auto text-term-muted hover:text-term-amber text-[11px] uppercase tracking-wider">
              Clear filters
            </button>
          )}
        </div>
      </div>

      <TradeTable trades={filtered} />
      <StatsPanel trades={filtered} />
    </div>
  );
}
