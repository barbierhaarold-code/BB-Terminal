import { useState } from "react";
import { cn } from "@/lib/cn";
import { DashboardPanel } from "./crypto/DashboardPanel";
import { DerivativesPanel } from "./crypto/DerivativesPanel";
import { LiquidationsPanel } from "./crypto/LiquidationsPanel";
import { EtfFlowsPanel } from "./crypto/EtfFlowsPanel";
import { OnChainPanel } from "./crypto/OnChainPanel";

type Tab = "dashboard" | "derivatives" | "liquidations" | "etf" | "onchain";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "derivatives", label: "Derivatives" },
  { id: "liquidations", label: "Liquidations" },
  { id: "etf", label: "ETF Flows" },
  { id: "onchain", label: "On-Chain" },
];

export function CRYPTO() {
  const [tab, setTab] = useState<Tab>("dashboard");

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
        {tab === "dashboard" && <DashboardPanel />}
        {tab === "derivatives" && <DerivativesPanel />}
        {tab === "liquidations" && <LiquidationsPanel />}
        {tab === "etf" && <EtfFlowsPanel />}
        {tab === "onchain" && <OnChainPanel />}
      </div>
    </div>
  );
}
