import { useState } from "react";
import { useJournal } from "@/store/journalStore";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

export function JournalSettings() {
  const { baseCapital, pricesHidden, setBaseCapital, togglePricesHidden } = useJournal();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(baseCapital));

  function commit() {
    const n = Number(draft.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) setBaseCapital(n);
    else setDraft(String(baseCapital));
    setEditing(false);
  }

  return (
    <div className="panel">
      <div className="panel-header"><span>SETTINGS</span></div>
      <div className="p-2 flex flex-col gap-2">
        <div>
          <div className="sub-header mb-1">BASE CAPITAL (USD)</div>
          {editing ? (
            <input
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              onBlur={commit}
              inputMode="decimal"
              className="w-full bg-term-panel border border-term-amber px-2 py-1 text-term-text num focus:outline-none"
            />
          ) : (
            <button
              onClick={() => { setDraft(String(baseCapital)); setEditing(true); }}
              className="w-full text-left bg-term-panel border border-term-border px-2 py-1 text-term-amberBright num hover:border-term-amber"
            >
              {pricesHidden ? "••••••" : fmtPrice(baseCapital, 0)}
            </button>
          )}
        </div>

        <button
          onClick={togglePricesHidden}
          className={cn("px-2 py-1.5 border text-[11px] uppercase tracking-wider font-bold",
            pricesHidden ? "border-term-amber text-term-amber bg-term-amberSubtle" : "border-term-border text-term-muted hover:text-term-text")}
        >
          {pricesHidden ? "◉ P&L hidden" : "○ hide P&L"}
        </button>
        <div className="sub-header normal-case tracking-normal font-normal text-term-muted">
          Hides per-trade result, $ aggregates, and return/drawdown/risk %.
          Entry, exit, size, and win-rate-style ratios stay visible — they're
          not money made or lost.
        </div>
      </div>
    </div>
  );
}
