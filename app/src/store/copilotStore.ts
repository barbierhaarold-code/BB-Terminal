import { create } from "zustand";
import { callCopilot } from "@/lib/copilotClient";
import { runCopilotTool, COPILOT_TOOLS } from "@/lib/copilotTools";
import {
  SYSTEM_PROMPT, MAX_TOOL_ROUNDS, currentViewLabel,
  type ChatMessage, type ContentBlock, type ToolCallLog, type CurrentView,
} from "@/lib/copilotConfig";

interface CopilotState {
  isOpen: boolean;
  currentView: CurrentView;
  messages: ChatMessage[];
  toolLog: ToolCallLog[];
  status: "idle" | "loading" | "error";
  errorMessage?: string;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setCurrentView: (v: CurrentView) => void;
  sendMessage: (text: string) => Promise<void>;
  reset: () => void;
}

/**
 * The AI Copilot's tool-calling loop runs entirely client-side (not proxied
 * through a Python backend — see the comment on copilotProxyPlugin in
 * vite.config.ts for why): two of the four tools (Track Record, Portfolio)
 * read Zustand stores that only exist in the browser, so a server-side
 * executor could never reach them without reimplementing storage. State is
 * deliberately not persisted — conversation resets on reload, per spec v1.
 */
export const useCopilot = create<CopilotState>()((set, get) => ({
  isOpen: false,
  currentView: "other",
  messages: [],
  toolLog: [],
  status: "idle",
  errorMessage: undefined,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setCurrentView: (v) => set({ currentView: v }),

  reset: () => set({ messages: [], toolLog: [], status: "idle", errorMessage: undefined }),

  sendMessage: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || get().status === "loading") return;

    const userMsg: ChatMessage = { role: "user", content: [{ type: "text", text: trimmed }] };
    let messages = [...get().messages, userMsg];
    set({ messages, status: "loading", errorMessage: undefined });

    const system = `${SYSTEM_PROMPT}\n\nHarold is currently viewing ${currentViewLabel(get().currentView)}.`;

    try {
      let done = false;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const res = await callCopilot(system, messages, COPILOT_TOOLS);
        const assistantMsg: ChatMessage = { role: "assistant", content: res.content };
        messages = [...messages, assistantMsg];
        set({ messages });

        const toolUses = res.content.filter(
          (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use"
        );
        if (toolUses.length === 0) { done = true; break; }

        const results = await Promise.all(
          toolUses.map(async (tu): Promise<ContentBlock> => {
            try {
              const output = await runCopilotTool(tu.name, tu.input);
              console.log(`[copilot] tool called: ${tu.name}`, tu.input, "→", output);
              set((s) => ({ toolLog: [...s.toolLog, { id: tu.id, name: tu.name, input: tu.input, output, isError: false }] }));
              return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) };
            } catch (e) {
              const message = (e as Error).message;
              console.log(`[copilot] tool FAILED: ${tu.name}`, tu.input, "→", message);
              set((s) => ({ toolLog: [...s.toolLog, { id: tu.id, name: tu.name, input: tu.input, output: { error: message }, isError: true }] }));
              return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: message }), is_error: true };
            }
          })
        );
        messages = [...messages, { role: "user", content: results }];
        set({ messages });
      }

      if (!done) {
        throw new Error(`Stopped after ${MAX_TOOL_ROUNDS} tool-call rounds without a final answer — try a more specific question.`);
      }
      set({ status: "idle" });
    } catch (e) {
      set({ status: "error", errorMessage: (e as Error).message });
    }
  },
}));
