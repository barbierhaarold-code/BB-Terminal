import { useState } from "react";
import { cn } from "@/lib/cn";
import { NewsPanel } from "./newshub/NewsPanel";
import { TweetsPanel } from "./newshub/TweetsPanel";
import { MarketHoursPanel } from "./newshub/MarketHoursPanel";
import { LiveTvPanel } from "./newshub/LiveTvPanel";
import { EconCalendarPanel } from "./newshub/EconCalendarPanel";
import { EarningsPanel } from "./newshub/EarningsPanel";
import { CorporatePanel } from "./newshub/CorporatePanel";
import { PredictionMarketsPanel } from "./newshub/PredictionMarketsPanel";
import { FedWatchPanel } from "./newshub/FedWatchPanel";

type Tab =
  | "news" | "tweets" | "econ" | "earnings" | "corporate"
  | "predictions" | "fedwatch" | "hours" | "tv";

const TABS: { id: Tab; label: string }[] = [
  { id: "news", label: "News" },
  { id: "tweets", label: "Tweets" },
  { id: "econ", label: "Econ Calendar" },
  { id: "earnings", label: "Earnings" },
  { id: "corporate", label: "Corporate" },
  { id: "predictions", label: "Prediction Markets" },
  { id: "fedwatch", label: "Fed Ops / FedWatch" },
  { id: "hours", label: "Market Hours" },
  { id: "tv", label: "Live TV" },
];

export function NH() {
  const [tab, setTab] = useState<Tab>("news");

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
        {tab === "news" && <NewsPanel />}
        {tab === "tweets" && <TweetsPanel />}
        {tab === "hours" && <MarketHoursPanel />}
        {tab === "tv" && <LiveTvPanel />}
        {tab === "econ" && <EconCalendarPanel />}
        {tab === "earnings" && <EarningsPanel />}
        {tab === "corporate" && <CorporatePanel />}
        {tab === "predictions" && <PredictionMarketsPanel />}
        {tab === "fedwatch" && <FedWatchPanel />}
      </div>
    </div>
  );
}
