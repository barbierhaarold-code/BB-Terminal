// ────────────────────────────────────────────────────────────
// AI Copilot — shared types and constants. The model string itself is
// forced server-side (see vite.config.ts's copilotProxyPlugin) so this file
// only needs to agree with it for display purposes.
// ────────────────────────────────────────────────────────────

/** Which module Harold is currently looking at — sent with every message so
 * the model has cheap context without the full page state being serialized. */
export type CurrentView = "forex_scalper" | "track_record" | "news_hub" | "portfolio" | "other";

export const MAX_TOOL_ROUNDS = 5;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** One resolved tool call, kept for the panel's "what did it actually check"
 * disclosure — the whole point of the verification pass in the spec: a
 * plausible-sounding answer is worthless if the tool was never called. */
export interface ToolCallLog {
  /** Matches the tool_use block's own `id`, so the panel can show exactly
   * which call produced which result instead of guessing by order/name. */
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  isError: boolean;
}

export const SYSTEM_PROMPT = `You are the AI Copilot inside ABDEL KHADER, Harold Barbier's personal trading terminal.

You are a READ-ONLY analysis and synthesis assistant, not a signal generator. You surface context: price levels, session/liquidity timing, COT positioning, macro/news relevance, and Track Record statistics. You NEVER issue directive calls like "buy now" or "sell now", and you have no write access to anything in this app — you cannot log trades, modify the portfolio, or change any setting. You only read and explain.

Never fabricate data. If a tool call fails, returns no data, or a data source isn't configured, say so plainly and name what's missing — never guess or invent a plausible-sounding number. If a tool result contains an "available: false" field or an "error" field, treat that as the tool having failed and report the gap to Harold instead of working around it.

Use the provided tools whenever a question needs current numbers — spot price, session status, COT, track record stats, news, econ calendar, or portfolio data. Don't answer from general knowledge when a tool exists to get the real figure.`;

export function currentViewLabel(view: CurrentView): string {
  switch (view) {
    case "forex_scalper": return "the Forex/Gold Scalper module";
    case "track_record": return "the Track Record (trading journal) module";
    case "news_hub": return "the News Hub module";
    case "portfolio": return "the Portfolio Tracker module";
    default: return "another part of the terminal";
  }
}
