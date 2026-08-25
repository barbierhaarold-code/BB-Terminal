import { useState } from "react";
import { cn } from "@/lib/cn";
import { CorrelationMatrixPanel } from "./quant/CorrelationMatrixPanel";
import { CointegrationPanel } from "./quant/CointegrationPanel";
import { ZScorePanel } from "./quant/ZScorePanel";
import { BetaHedgePanel } from "./quant/BetaHedgePanel";
import { SectorRotationPanel } from "./quant/SectorRotationPanel";
import { CotPanel } from "./quant/CotPanel";

type Tab = "correlation" | "cointegration" | "zscore" | "beta" | "rotation" | "cot";

const TABS: { id: Tab; label: string }[] = [
  { id: "correlation", label: "Correlation Matrix" },
  { id: "cointegration", label: "Cointegration" },
  { id: "zscore", label: "Z-Score" },
  { id: "beta", label: "Beta / Hedge" },
  { id: "rotation", label: "Sector Rotation" },
  { id: "cot", label: "COT" },
];

const LOOKBACKS = [
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
];

const PAIR_TABS: Tab[] = ["cointegration", "zscore", "beta"];

export function QUANT() {
  const [tab, setTab] = useState<Tab>("correlation");
  const [symbolA, setSymbolA] = useState("XOM");
  const [symbolB, setSymbolB] = useState("CVX");
  const [lookback, setLookback] = useState(LOOKBACKS[1]);

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

      {PAIR_TABS.includes(tab) && (
        <PairToolbar
          symbolA={symbolA} symbolB={symbolB} lookback={lookback}
          onSymbolA={setSymbolA} onSymbolB={setSymbolB} onLookback={setLookback}
        />
      )}

      <div className="flex-1 min-h-0">
        {tab === "correlation" && <CorrelationMatrixPanel />}
        {tab === "cointegration" && <CointegrationPanel symbolA={symbolA} symbolB={symbolB} lookbackDays={lookback.days} />}
        {tab === "zscore" && <ZScorePanel symbolA={symbolA} symbolB={symbolB} lookbackDays={lookback.days} />}
        {tab === "beta" && <BetaHedgePanel symbolA={symbolA} symbolB={symbolB} lookbackDays={lookback.days} />}
        {tab === "rotation" && <SectorRotationPanel />}
        {tab === "cot" && <CotPanel />}
      </div>
    </div>
  );
}

function PairToolbar({
  symbolA, symbolB, lookback, onSymbolA, onSymbolB, onLookback,
}: {
  symbolA: string; symbolB: string; lookback: (typeof LOOKBACKS)[number];
  onSymbolA: (s: string) => void; onSymbolB: (s: string) => void; onLookback: (l: (typeof LOOKBACKS)[number]) => void;
}) {
  return (
    <div className="flex items-center gap-2 h-8 px-3 border-b border-term-border bg-term-panel text-[11px]">
      <span className="sub-header">Pair</span>
      <PairInput value={symbolA} onChange={onSymbolA} />
      <span className="text-term-muted">/</span>
      <PairInput value={symbolB} onChange={onSymbolB} />
      <div className="flex items-center gap-1 ml-auto">
        {LOOKBACKS.map((l) => (
          <button key={l.label} onClick={() => onLookback(l)}
            className={cn("px-1.5 py-0.5 border text-[10px] uppercase tracking-wider",
              l.label === lookback.label ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PairInput({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value.toUpperCase())}
      onBlur={() => draft.trim() && onChange(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && draft.trim() && onChange(draft.trim())}
      className="bg-term-panel2 border border-term-border px-1.5 py-0.5 text-term-text w-20 text-center focus:outline-none focus:border-term-amber"
    />
  );
}
