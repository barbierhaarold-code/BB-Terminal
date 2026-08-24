import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChainPanel } from "./optionsmon/ChainPanel";
import { ExpectedRangePanel } from "./optionsmon/ExpectedRangePanel";
import { ImpliedVolPanel } from "./optionsmon/ImpliedVolPanel";
import { OpenInterestPanel } from "./optionsmon/OpenInterestPanel";
import { UnusualActivityPanel } from "./optionsmon/UnusualActivityPanel";
import { GreeksExposurePanel } from "./optionsmon/GreeksExposurePanel";

type Tab = "chain" | "range" | "iv" | "oi" | "unusual" | "greeks";

const TABS: { id: Tab; label: string }[] = [
  { id: "chain", label: "Chain" },
  { id: "range", label: "Expected Range" },
  { id: "iv", label: "Implied Vol" },
  { id: "oi", label: "Open Interest" },
  { id: "unusual", label: "Unusual Activity" },
  { id: "greeks", label: "Greeks Exposure" },
];

export function OMON({ symbol }: { symbol: string }) {
  const [tab, setTab] = useState<Tab>("chain");

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
        {tab === "chain" && <ChainPanel symbol={symbol} />}
        {tab === "range" && <ExpectedRangePanel symbol={symbol} />}
        {tab === "iv" && <ImpliedVolPanel symbol={symbol} />}
        {tab === "oi" && <OpenInterestPanel symbol={symbol} />}
        {tab === "unusual" && <UnusualActivityPanel symbol={symbol} />}
        {tab === "greeks" && <GreeksExposurePanel symbol={symbol} />}
      </div>
    </div>
  );
}
