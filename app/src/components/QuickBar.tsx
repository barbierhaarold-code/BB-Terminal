import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useWorkspace } from "@/store/workspaceStore";
import { FUNCTIONS, FN_BY_CODE, type FunctionCode } from "@/lib/functions";
import { cn } from "@/lib/cn";

// A handful of visible top-level categories, each nesting its pages — not
// one long flat row of ~20 codes. Categories with a single page (Forex,
// Crypto, News, Options) are direct buttons; Research/Markets have enough
// pages to warrant a real dropdown. CC and HELP are pinned outside the
// category structure since they're not really "nested content."
interface Category { label: string; codes: FunctionCode[]; }
const CATEGORIES: Category[] = [
  { label: "Research", codes: ["INTEL", "DES", "GP", "QR", "HP", "FA", "KEY", "DVD", "EE"] },
  { label: "Markets", codes: ["WEI", "MOV", "QCARD", "HEAT", "CURV"] },
  { label: "Forex", codes: ["FXC"] },
  { label: "Crypto", codes: ["CRYPTO"] },
  { label: "News", codes: ["NI", "NH"] },
  { label: "Options", codes: ["OMON"] },
  { label: "Journal", codes: ["TRACK"] },
];
const PINNED: FunctionCode[] = ["CC", "HELP"];

const NAV_COVERED = new Set<FunctionCode>([...PINNED, ...CATEGORIES.flatMap((c) => c.codes)]);
const NAV_MISSING = FUNCTIONS.map((f) => f.code).filter((c) => !NAV_COVERED.has(c));
if (NAV_MISSING.length > 0) {
  console.warn(`[QuickBar] ${NAV_MISSING.join(", ")} exist in FUNCTIONS but have no nav entry — add them to CATEGORIES or PINNED.`);
}

export function QuickBar() {
  const { openTab, activeSymbol, tabs, activeTabId } = useWorkspace();
  const activeCode = tabs.find((t) => t.id === activeTabId)?.code;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(code: FunctionCode) {
    const fn = FN_BY_CODE[code];
    openTab(code, fn.needsSymbol ? (activeSymbol ?? "AAPL") : undefined);
    setOpenGroup(null);
  }

  return (
    <div ref={rootRef} className="flex items-stretch h-9 bg-term-bg2 border-b border-term-border relative">
      {/* Home — pinned, not nested */}
      <NavButton label="Home" isActive={activeCode === "CC"} onClick={() => go("CC")} />

      {CATEGORIES.map((cat) => {
        const single = cat.codes.length === 1;
        const isOpen = openGroup === cat.label;
        const containsActive = cat.codes.includes(activeCode as FunctionCode);
        if (single) {
          return (
            <NavButton
              key={cat.label}
              label={cat.label}
              isActive={containsActive}
              onClick={() => go(cat.codes[0])}
            />
          );
        }
        return (
          <div key={cat.label} className="relative">
            <NavButton
              label={cat.label}
              isActive={containsActive}
              chevron
              onClick={() => setOpenGroup(isOpen ? null : cat.label)}
            />
            {isOpen && (
              <div className="absolute top-full left-0 z-50 bg-term-panel border border-term-border shadow-panel min-w-[220px] py-1">
                {cat.codes.map((code) => {
                  const fn = FN_BY_CODE[code];
                  const isActive = code === activeCode;
                  return (
                    <button
                      key={code}
                      onClick={() => go(code)}
                      title={fn.summary}
                      className={cn(
                        "w-full flex items-baseline gap-3 px-3 py-1.5 text-left text-[12px]",
                        isActive ? "bg-term-amberSubtle text-term-amber" : "text-term-text hover:bg-term-panel2 hover:text-term-heading"
                      )}
                    >
                      <span className="flex-1">{fn.name}</span>
                      <span className="num text-[9px] text-term-muted/60 tracking-[0.15em]">{fn.code}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Help — pinned at the end, small */}
      <div className="ml-auto">
        <NavButton label="Help" isActive={activeCode === "HELP"} onClick={() => go("HELP")} />
      </div>
    </div>
  );
}

function NavButton({ label, isActive, onClick, chevron }: {
  label: string; isActive: boolean; onClick: () => void; chevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-3.5 h-full text-[11px] uppercase tracking-[0.12em] border-r border-term-border transition-colors",
        isActive ? "bg-term-amberSubtle text-term-amber font-semibold" : "text-term-muted hover:bg-term-panel2 hover:text-term-text"
      )}
    >
      {label}
      {chevron && <ChevronDown size={11} className="opacity-60" />}
    </button>
  );
}
