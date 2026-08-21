import { FUNCTIONS } from "@/lib/functions";
import { useWorkspace } from "@/store/workspaceStore";

export function HELP() {
  const openTab = useWorkspace((s) => s.openTab);
  const activeSymbol = useWorkspace((s) => s.activeSymbol);

  const groups = Array.from(new Set(FUNCTIONS.map((f) => f.group)));

  return (
    <div className="p-4 flex flex-col gap-5 text-[12px]">
      <div>
        <div className="text-term-amber text-[11px] tracking-[0.25em] font-bold mb-1">WELCOME TO ABDEL KHADER</div>
        <div className="text-term-text">
          Type a function code in the command bar above, optionally prefixed with a ticker, then press
          <span className="text-term-amber font-bold mx-1">&lt;GO&gt;</span>
          or <span className="text-term-amber">Enter</span>.
        </div>
        <div className="text-term-muted mt-2">
          EXAMPLES:&nbsp;&nbsp;
          <code className="text-term-amberBright">CC</code>&nbsp;(dashboard)&nbsp;·&nbsp;
          <code className="text-term-amberBright">AAPL</code>&nbsp;(intel scorecard)&nbsp;·&nbsp;
          <code className="text-term-amberBright">TSLA OMON</code>&nbsp;·&nbsp;
          <code className="text-term-amberBright">FXC</code>&nbsp;(forex)&nbsp;·&nbsp;
          <code className="text-term-amberBright">CURV</code>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g}>
          <div className="text-term-amber text-[10px] tracking-[0.25em] font-bold border-b border-term-border pb-1 mb-2">{g.toUpperCase()}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
            {FUNCTIONS.filter((f) => f.group === g).map((f) => (
              <button
                key={f.code}
                onClick={() =>
                  openTab(f.code, f.needsSymbol ? activeSymbol ?? "AAPL" : undefined)
                }
                className="flex items-baseline gap-3 text-left py-1 hover:bg-term-amberSubtle px-2 -mx-2"
              >
                <span className="text-term-amber font-bold w-16 shrink-0">{f.code}</span>
                <span className="text-term-heading">{f.name}</span>
                <span className="text-term-muted text-[11px] ml-auto truncate max-w-[50%] hidden lg:inline">{f.summary}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="border-t border-term-border pt-3 text-term-muted text-[11px] leading-relaxed">
        Data is polled (not streaming). All price data comes from Yahoo Finance via OpenBB Platform.
        Some functions require API keys (economic calendar, CPI, global news) — configure via
        <code className="text-term-amberBright mx-1">~/.openbb_platform/user_settings.json</code>.
      </div>
    </div>
  );
}
