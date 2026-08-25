import { useState } from "react";
import { cn } from "@/lib/cn";
import { FundsPanel } from "./investors/FundsPanel";
import { RankingPanel } from "./investors/RankingPanel";
import { InsiderTradingPanel } from "./investors/InsiderTradingPanel";
import { CongressPanel } from "./investors/CongressPanel";
import { WhaleRadarPanel } from "./investors/WhaleRadarPanel";

type Tab = "funds" | "ranking" | "insider" | "congress" | "whale";

const TABS: { id: Tab; label: string }[] = [
  { id: "funds", label: "Funds / 13F" },
  { id: "ranking", label: "Ranking" },
  { id: "insider", label: "Insider Trading" },
  { id: "congress", label: "Congress" },
  { id: "whale", label: "Whale Radar" },
];

export function INVEST() {
  const [tab, setTab] = useState<Tab>("funds");

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
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "funds" && <FundsPanel />}
        {tab === "ranking" && <RankingPanel />}
        {tab === "insider" && <InsiderTradingPanel />}
        {tab === "congress" && <CongressPanel />}
        {tab === "whale" && <WhaleRadarPanel />}
      </div>
    </div>
  );
}
