import { useEffect, useRef, useState } from "react";
import { parseCommand, FUNCTIONS } from "@/lib/functions";
import { useWorkspace } from "@/store/workspaceStore";
import { GlobalSearch } from "@/components/GlobalSearch";
import { cn } from "@/lib/cn";

export function CommandBar() {
  const [input, setInput] = useState("");
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { openTab, activeSymbol } = useWorkspace();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Suggestions based on current token
  const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? "";
  const suggestions =
    tokens.length === 0
      ? []
      : FUNCTIONS.filter((f) => f.code.startsWith(last)).slice(0, 5);

  function run() {
    const raw = input.trim();
    if (!raw) return;
    const parsed = parseCommand(raw, activeSymbol);
    if (!parsed) {
      setErr("UNKNOWN COMMAND — TRY: HELP");
      return;
    }
    openTab(parsed.code, parsed.symbol);
    setHistory((h) => [raw.toUpperCase(), ...h].slice(0, 20));
    setHistIdx(null);
    setInput("");
    setErr(null);
  }

  return (
    <div className="flex flex-wrap items-center min-h-10 bg-term-panel border-b border-term-border px-3 py-1.5 sm:py-0 gap-2 sm:gap-4">
      <div className="flex items-center gap-2 select-none shrink-0">
        <span className="w-1.5 h-1.5 bg-term-amber shadow-[0_0_6px_rgba(180,92,255,0.9)]" />
        <span className="text-term-amber font-bold tracking-[0.3em] text-[11px]">ABDEL KHADER</span>
      </div>

      {/* Primary, always-visible way to find an instrument — equity, forex
          pair, metal, or crypto — without knowing a function code. */}
      <GlobalSearch />

      {/* Active ticker context — the symbol GP/KEY/FA/etc. carry when opened
          from a stock page. Made a standalone badge (not buried in the hint
          text on the right) so switching context is visible, not implicit. */}
      <button
        onClick={() => activeSymbol && openTab("INTEL", activeSymbol)}
        title="Active ticker context — carries into GP, KEY, FA, DES, etc. Click to open INTEL."
        className="flex items-center gap-1.5 px-2.5 py-1 border border-term-amberDim bg-term-amberSubtle shrink-0 hover:border-term-amber transition-colors"
      >
        <span className="text-[9px] uppercase tracking-[0.18em] text-term-muted">CTX</span>
        <span className="text-term-amber font-bold text-[13px] num tracking-wider">{activeSymbol ?? "—"}</span>
      </button>

      {/* Power-user command prompt — typed function codes (CC, GP, KEY…),
          optionally prefixed/suffixed with a symbol. Demoted in width/weight
          now that GlobalSearch is the primary discovery surface, but fully
          functional — codes still work here for anyone who wants them. */}
      <div className="flex items-center gap-1.5 relative shrink-0 w-full sm:w-[220px] order-last sm:order-none">
        <span className="text-term-amberDim text-[10px] uppercase tracking-widest">CMD</span>
        <span className="text-term-amberDim text-[11px]">{">"}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setErr(null); setSuggestIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
            else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (history.length === 0) return;
              const next = histIdx == null ? 0 : Math.min(history.length - 1, histIdx + 1);
              setHistIdx(next); setInput(history[next]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (histIdx == null) return;
              const next = histIdx - 1;
              if (next < 0) { setHistIdx(null); setInput(""); }
              else { setHistIdx(next); setInput(history[next]); }
            } else if (e.key === "Tab" && suggestions.length > 0) {
              e.preventDefault();
              const rest = tokens.slice(0, -1);
              setInput([...rest, suggestions[suggestIdx].code].join(" ") + " ");
            }
          }}
          placeholder="function code…"
          spellCheck={false}
          autoCapitalize="characters"
          className="flex-1 min-w-0 bg-transparent uppercase text-term-amberBright placeholder:text-term-muted focus:outline-none text-[12px] tracking-wider"
        />
        <span className="text-term-amber text-[10px] font-bold px-1.5 py-0.5 border border-term-amberDim hover:bg-term-amberSubtle cursor-pointer select-none shrink-0" onClick={run}>
          GO
        </span>

        {suggestions.length > 0 && (
          <div className="absolute top-full right-0 mt-1 z-50 bg-term-panel border border-term-border shadow-panel min-w-[360px]">
            {suggestions.map((f, i) => (
              <div
                key={f.code}
                onMouseEnter={() => setSuggestIdx(i)}
                onClick={() => { setInput(f.code + " "); inputRef.current?.focus(); }}
                className={cn(
                  "flex items-baseline gap-3 px-3 py-1.5 text-[12px] cursor-pointer",
                  i === suggestIdx && "bg-term-amberSubtle"
                )}
              >
                <span className="text-term-amber font-bold w-14">{f.code}</span>
                <span className="text-term-heading flex-1">{f.name}</span>
                <span className="sub-header">{f.group}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <span className="text-term-red text-[10px] uppercase tracking-[0.18em] shrink-0">{err}</span>}
    </div>
  );
}
