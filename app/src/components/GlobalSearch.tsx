import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useSymbolSearch, type SearchHit } from "@/lib/search";
import { useWorkspace } from "@/store/workspaceStore";
import { FN_BY_CODE } from "@/lib/functions";
import { cn } from "@/lib/cn";

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  equity: "EQUITY",
  forex: "FOREX",
  metal: "METAL",
  crypto: "CRYPTO",
  index: "INDEX",
};
const KIND_COLOR: Record<SearchHit["kind"], string> = {
  equity: "text-term-amber",
  forex: "text-term-cyan",
  metal: "text-term-amberBright",
  crypto: "text-term-green",
  index: "text-term-cyan",
};

/**
 * Persistent, always-visible unified symbol search — the primary way to find
 * an instrument (equity, forex pair, metal, or crypto) without knowing a
 * function code. Merges the equity universe + forex/metals list + crypto
 * list into one live-matching dropdown (see lib/search.ts). Selecting a hit
 * navigates straight to its relevant view and sets it as the active context.
 * The CMD prompt elsewhere in this bar still takes typed function codes —
 * this bar is the casual, discovery-first counterpart to it.
 */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { hits, isSearching } = useSymbolSearch(query);
  const openTab = useWorkspace((s) => s.openTab);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => { setIdx(0); }, [query]);

  function select(hit: SearchHit) {
    // Every function that needs a symbol should get one, not just equities —
    // this was previously equity-only and silently dropped the symbol for
    // forex/metal/index hits, which broke once those started targeting GP.
    openTab(hit.target, FN_BY_CODE[hit.target].needsSymbol ? hit.symbol : undefined);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div ref={rootRef} className="relative flex-1 min-w-[140px] max-w-[380px]">
      <div className={cn(
        "flex items-center gap-2 h-8 px-2.5 border bg-term-bg2 transition-colors",
        open ? "border-term-amber" : "border-term-border"
      )}>
        <Search size={13} className="text-term-muted shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter" && hits[idx]) { select(hits[idx]); }
            else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
          }}
          placeholder="Search any symbol — AAPL, XAUUSD, BTC…"
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-term-text placeholder:text-term-muted focus:outline-none text-[12px]"
        />
      </div>

      {open && query.trim().length > 0 && (
        <div className="absolute top-full left-0 mt-1 z-50 w-full min-w-[320px] bg-term-panel border border-term-border shadow-panel max-h-[360px] overflow-auto scroll-thin">
          {hits.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-term-muted uppercase tracking-widest">
              {isSearching ? "Searching…" : "No matches"}
            </div>
          )}
          {hits.map((hit, i) => (
            <div
              key={hit.kind + hit.symbol}
              onMouseEnter={() => setIdx(i)}
              onClick={() => select(hit)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-[12px] cursor-pointer",
                i === idx && "bg-term-amberSubtle"
              )}
            >
              <span className={cn("font-bold w-16 shrink-0", KIND_COLOR[hit.kind])}>{hit.label}</span>
              <span className="text-term-text flex-1 truncate">{hit.sublabel}</span>
              <span className="sub-header shrink-0">{KIND_LABEL[hit.kind]}</span>
            </div>
          ))}
          {isSearching && hits.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-term-muted uppercase tracking-widest border-t border-term-borderSoft">
              Searching for more…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
