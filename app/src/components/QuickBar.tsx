import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  { label: "Research", codes: ["INTEL", "RESEARCH", "DES", "GP", "QR", "HP", "FA", "KEY", "DVD", "EE"] },
  { label: "Markets", codes: ["WEI", "MOV", "QCARD", "HEAT", "INVEST", "CURV"] },
  { label: "Forex", codes: ["FXC"] },
  { label: "Crypto", codes: ["CRYPTO"] },
  { label: "News", codes: ["NI", "NH"] },
  { label: "Options", codes: ["OMON"] },
  { label: "Journal", codes: ["TRACK"] },
];
const PINNED: FunctionCode[] = ["CC", "HELP"];

const NAV_COVERED = new Set<FunctionCode>([...PINNED, ...CATEGORIES.flatMap((c) => c.codes)]);

// Structural safety net, not just a lint warning: RESEARCH (phase 4) and
// INVEST (phase 6) were both added to FUNCTIONS and shipped without ever
// being added here — typeable in the command bar, invisible in every visible
// menu, twice. A console.warn didn't stop either. Any FUNCTIONS entry still
// uncovered after the curated list above is auto-appended to the category
// matching its own `group` (creating one if none exists yet), so a future
// addition is at worst in an unpolished spot in the nav — never nowhere.
for (const fn of FUNCTIONS) {
  if (NAV_COVERED.has(fn.code)) continue;
  let cat = CATEGORIES.find((c) => c.label === fn.group);
  if (!cat) {
    cat = { label: fn.group, codes: [] };
    CATEGORIES.push(cat);
  }
  cat.codes.push(fn.code);
  NAV_COVERED.add(fn.code);
}

export function QuickBar() {
  const { openTab, activeSymbol, tabs, activeTabId } = useWorkspace();
  const activeCode = tabs.find((t) => t.id === activeTabId)?.code;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Dropdown position, captured from the trigger button's own bounding box
  // at open time. The panel itself is portaled to <body> (see below), not
  // rendered inline, so it needs an explicit screen position instead of
  // relying on `absolute` + a `relative` ancestor.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      // The dropdown is portaled outside rootRef, so an "outside click"
      // check against rootRef alone would treat every click inside the
      // open dropdown as outside and close it instantly — check both.
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpenGroup(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!openGroup) return;
    // The panel is positioned in fixed screen coordinates captured once at
    // open time — resizing the window would leave it visually detached from
    // its trigger, so just close it rather than track a stale position.
    // (Deliberately NOT closing on nav-row scroll: a horizontal swipe can
    // still be settling — momentum scroll, or the scrollIntoView a tap on a
    // partly-offscreen trigger causes — right as the menu opens, and a
    // scroll listener here would catch that trailing scroll and close the
    // menu it just opened. A dropdown that's merely out of sync with a
    // since-scrolled trigger is a much smaller cost than one that closes
    // itself moments after opening.)
    const close = () => setOpenGroup(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [openGroup]);

  function go(code: FunctionCode) {
    const fn = FN_BY_CODE[code];
    openTab(code, fn.needsSymbol ? (activeSymbol ?? "AAPL") : undefined);
    setOpenGroup(null);
  }

  function toggleGroup(label: string, trigger: HTMLElement) {
    if (openGroup === label) { setOpenGroup(null); return; }
    const r = trigger.getBoundingClientRect();
    setMenuPos({ top: r.bottom, left: r.left });
    setOpenGroup(label);
  }

  const openCat = CATEGORIES.find((c) => c.label === openGroup);

  return (
    <div ref={rootRef} className="flex items-stretch h-9 bg-term-bg2 border-b border-term-border relative overflow-x-auto scroll-thin">
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
          <NavButton
            key={cat.label}
            label={cat.label}
            isActive={containsActive || isOpen}
            chevron
            onClick={(e) => toggleGroup(cat.label, e.currentTarget)}
          />
        );
      })}

      {/* Help — pinned at the end, small */}
      <div className="ml-auto shrink-0">
        <NavButton label="Help" isActive={activeCode === "HELP"} onClick={() => go("HELP")} />
      </div>

      {/* Portaled to <body> so the QuickBar row's own overflow-x-auto (needed
          to keep the row itself from forcing page-wide horizontal scroll on
          narrow viewports) can't clip it — an overflow ancestor clips *any*
          descendant, including `position: absolute` ones, regardless of
          which element is its positioning context. */}
      {openCat && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
          className="z-50 bg-term-panel border border-term-border shadow-panel min-w-[220px] py-1"
        >
          {openCat.codes.map((code) => {
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
        </div>,
        document.body
      )}
    </div>
  );
}

function NavButton({ label, isActive, onClick, chevron }: {
  label: string; isActive: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; chevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-3.5 h-full text-[11px] uppercase tracking-[0.12em] border-r border-term-border transition-colors shrink-0",
        isActive ? "bg-term-amberSubtle text-term-amber font-semibold" : "text-term-muted hover:bg-term-panel2 hover:text-term-text"
      )}
    >
      {label}
      {chevron && <ChevronDown size={11} className="opacity-60" />}
    </button>
  );
}
