import { ApiError } from "@/lib/api";
import type { ChatMessage } from "@/lib/copilotConfig";

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessageResponse {
  id: string;
  role: "assistant";
  content: ChatMessage["content"];
  stop_reason: string | null;
}

/**
 * Posts one turn of the tool-calling loop to the dev-server proxy (see
 * copilotProxyPlugin in vite.config.ts), which attaches ANTHROPIC_API_KEY
 * server-side and forwards to /v1/messages. Model/max_tokens are decided by
 * the proxy, not here — this only ever sends system/messages/tools.
 */
export async function callCopilot(system: string, messages: ChatMessage[], tools: AnthropicTool[]): Promise<AnthropicMessageResponse> {
  const res = await fetch("/copilot-proxy/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, messages, tools }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.results) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Copilot request failed");
  }
  return body.results as AnthropicMessageResponse;
}
