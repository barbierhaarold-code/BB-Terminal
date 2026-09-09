import { useEffect, useRef, useState } from "react";
import { Bot, X, Send, RotateCcw, Wrench, TriangleAlert } from "lucide-react";
import { useCopilot } from "@/store/copilotStore";
import { cn } from "@/lib/cn";
import type { ContentBlock } from "@/lib/copilotConfig";

const EXAMPLE_PROMPTS = [
  "What's spot XAU right now and are we in the London/NY overlap?",
  "What's my current win rate and profit factor?",
  "What's the next major econ event and could it move gold?",
  "How's my portfolio doing vs the S&P 500?",
];

export function CopilotPanel() {
  const { isOpen, close, messages, status, errorMessage, toolLog, sendMessage, reset } = useCopilot();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function submit() {
    const text = input;
    setInput("");
    void sendMessage(text);
  }

  return (
    <div
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40 w-full sm:w-[380px] bg-term-panel border-l border-term-border shadow-panel flex flex-col transition-transform duration-200",
        isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
      )}
    >
      <div className="flex items-center justify-between h-10 px-3 border-b border-term-border bg-term-panel2 shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-term-amber" />
          <span className="text-term-heading text-[11px] uppercase tracking-[0.2em] font-bold">AI Copilot</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={reset} title="Reset conversation" className="p-1.5 text-term-muted hover:text-term-text">
            <RotateCcw size={13} />
          </button>
          <button onClick={close} title="Close" className="p-1.5 text-term-muted hover:text-term-text">
            <X size={15} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto scroll-thin p-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="text-term-muted text-[11px] leading-relaxed">
              Ask about live gold/FX conditions, your Track Record stats, recent news &amp; the econ calendar, or your
              portfolio. Read-only — this copilot never places or logs trades.
            </div>
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void sendMessage(p)}
                  className="text-left text-[11px] text-term-amberBright border border-term-amberDim bg-term-amberSubtle px-2.5 py-1.5 hover:border-term-amber"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBlocks key={i} role={m.role} content={m.content} toolLog={toolLog} />
        ))}

        {status === "loading" && (
          <div className="text-term-muted text-[11px] uppercase tracking-widest animate-pulse">Thinking…</div>
        )}
        {status === "error" && errorMessage && (
          <div className="flex items-start gap-2 border border-term-redDim bg-term-red/10 text-term-red text-[11px] px-2.5 py-2">
            <TriangleAlert size={13} className="shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 p-2 border-t border-term-border shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) submit(); }}
          placeholder="Ask the copilot…"
          disabled={status === "loading"}
          className="flex-1 min-w-0 bg-term-bg2 border border-term-border px-2.5 py-1.5 text-[12px] text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amberDim"
        />
        <button
          onClick={submit}
          disabled={status === "loading" || !input.trim()}
          className="p-2 border border-term-amberDim text-term-amber hover:bg-term-amberSubtle disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

function MessageBlocks({ role, content, toolLog }: { role: "user" | "assistant"; content: ContentBlock[]; toolLog: ReturnType<typeof useCopilot.getState>["toolLog"] }) {
  const text = content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");
  const toolUses = content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
  // tool_result blocks render nothing of their own — they're shown folded
  // into the tool_use chip above via toolLog, so the transcript stays
  // readable instead of dumping raw JSON into the conversation.
  const hasToolResults = content.some((b) => b.type === "tool_result");
  if (!text && toolUses.length === 0 && hasToolResults) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", role === "user" ? "items-end" : "items-start")}>
      {toolUses.map((tu) => {
        const log = toolLog.find((l) => l.id === tu.id);
        return <ToolChip key={tu.id} name={tu.name} isError={log?.isError} pending={!log} />;
      })}
      {text && (
        <div
          className={cn(
            "max-w-[90%] text-[12px] leading-relaxed whitespace-pre-wrap px-2.5 py-1.5",
            role === "user" ? "bg-term-amberSubtle text-term-text" : "bg-term-panel2 text-term-text border border-term-borderSoft"
          )}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function ToolChip({ name, isError, pending }: { name: string; isError?: boolean; pending?: boolean }) {
  return (
    <div
      title={pending ? "Running…" : isError ? "Tool call failed" : "Tool call succeeded"}
      className={cn(
        "flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-1 border",
        pending && "border-term-border text-term-muted animate-pulse",
        !pending && isError && "border-term-redDim text-term-red",
        !pending && !isError && "border-term-amberDim text-term-amberBright"
      )}
    >
      <Wrench size={10} />
      {name}
    </div>
  );
}
