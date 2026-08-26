import { useState } from "react";
import { cn } from "@/lib/cn";
import { PositionsTable } from "./portfolio/PositionsTable";
import { AllocationPanel } from "./portfolio/AllocationPanel";
import { PerformanceChart } from "./portfolio/PerformanceChart";
import { RiskStatsPanel } from "./portfolio/RiskStatsPanel";
import { WatchlistNews } from "./portfolio/WatchlistNews";

type Tab = "positions" | "allocation" | "performance" | "risk" | "watchlist";

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "allocation", label: "Allocation" },
  { id: "performance", label: "Performance vs S&P 500" },
  { id: "risk", label: "Risk Stats" },
  { id: "watchlist", label: "Watchlist News" },
];

export function PORTFOLIO() {
  const [tab, setTab] = useState<Tab>("positions");

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[11px] uppercase tracking-wider overflow-x-auto scroll-thin">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-2 py-0.5 border shrink-0",
              tab === t.id ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === "positions" && <PositionsTable />}
        {tab === "allocation" && <AllocationPanel />}
        {tab === "performance" && <PerformanceChart />}
        {tab === "risk" && <RiskStatsPanel />}
        {tab === "watchlist" && <WatchlistNews />}
      </div>
    </div>
  );
}
