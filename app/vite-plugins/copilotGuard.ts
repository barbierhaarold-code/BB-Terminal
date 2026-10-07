import type { IncomingMessage } from "node:http";

// ────────────────────────────────────────────────────────────
// Request hardening for the Copilot proxy. The caller is already a verified,
// allowlisted user (see auth.ts); this bounds what they can make our Anthropic
// key pay for. The model and max_tokens are decided here, and only an explicit
// allowlist of fields is forwarded — anything else in the body is dropped.
// ────────────────────────────────────────────────────────────

export const COPILOT_LIMITS = {
  /** Whole request body, bytes. ~64k tokens worth of text at most. */
  maxBodyBytes: 256 * 1024,
  /** After a 413, how much more of the upload is read-and-discarded before the socket is cut. */
  drainCeilingBytes: 16 * 1024 * 1024,
  maxMessages: 80,
  maxSystemChars: 20_000,
  maxTools: 12,
  maxToolDescriptionChars: 4_000,
  maxToolSchemaBytes: 8_000,
  /** Output cap per upstream call; a client-sent max_tokens can only go lower. */
  maxTokens: 2048,
} as const;

export class CopilotRequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Reads the request body, aborting as soon as it exceeds the cap (the rest is never buffered). */
export async function readCappedBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CopilotRequestError(413, "request_too_large", `Request body is ${declared} bytes; the limit is ${maxBytes}. Start a new conversation or ask a shorter question.`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new CopilotRequestError(413, "request_too_large", `Request body exceeds the ${maxBytes}-byte limit. Start a new conversation or ask a shorter question.`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const bad = (msg: string) => new CopilotRequestError(400, "invalid_request", msg);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates the client body and returns the exact object to send upstream
 * (minus the model/max_tokens, which the caller sets). Throws CopilotRequestError.
 */
export function sanitizeCopilotPayload(raw: unknown): { system?: string; messages: unknown[]; tools?: unknown[]; maxTokens: number } {
  const L = COPILOT_LIMITS;
  if (!isObj(raw)) throw bad("Request body must be a JSON object.");

  let system: string | undefined;
  if (raw.system !== undefined) {
    if (typeof raw.system !== "string") throw bad("`system` must be a string.");
    if (raw.system.length > L.maxSystemChars) throw new CopilotRequestError(413, "request_too_large", `\`system\` is ${raw.system.length} characters; the limit is ${L.maxSystemChars}.`);
    system = raw.system;
  }

  if (!Array.isArray(raw.messages) || raw.messages.length === 0) throw bad("`messages` must be a non-empty array.");
  if (raw.messages.length > L.maxMessages) throw new CopilotRequestError(413, "too_many_messages", `${raw.messages.length} messages; the limit is ${L.maxMessages}. Start a new conversation.`);
  const messages = raw.messages.map((m, i) => {
    if (!isObj(m) || (m.role !== "user" && m.role !== "assistant")) throw bad(`messages[${i}].role must be "user" or "assistant".`);
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    if (!Array.isArray(m.content)) throw bad(`messages[${i}].content must be an array of blocks.`);
    const content = m.content.map((b, j) => {
      if (!isObj(b)) throw bad(`messages[${i}].content[${j}] must be an object.`);
      // The block types the Copilot loop actually exchanges: text, tool_use,
      // tool_result, and — because the forced model emits extended thinking —
      // thinking / redacted_thinking. Those MUST be echoed back verbatim
      // (signature included) on the next turn when the assistant also called a
      // tool, or Anthropic rejects the turn. No images/documents/server-tool blocks.
      if (b.type === "text" && typeof b.text === "string") return { type: "text", text: b.text };
      if (b.type === "thinking" && typeof b.thinking === "string" && typeof b.signature === "string") return { type: "thinking", thinking: b.thinking, signature: b.signature };
      if (b.type === "redacted_thinking" && typeof b.data === "string") return { type: "redacted_thinking", data: b.data };
      if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" && isObj(b.input)) return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      if (b.type === "tool_result" && typeof b.tool_use_id === "string" && (typeof b.content === "string" || b.content === undefined)) {
        return { type: "tool_result", tool_use_id: b.tool_use_id, content: b.content ?? "", ...(b.is_error === true ? { is_error: true } : {}) };
      }
      throw bad(`messages[${i}].content[${j}] has an unsupported block type.`);
    });
    return { role: m.role, content };
  });

  let tools: unknown[] | undefined;
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) throw bad("`tools` must be an array.");
    if (raw.tools.length > L.maxTools) throw new CopilotRequestError(413, "request_too_large", `${raw.tools.length} tools; the limit is ${L.maxTools}.`);
    tools = raw.tools.map((t, i) => {
      // Custom (client-executed) tools only. A `type` like web_search_* / code_execution_* would be a server tool billed to our key.
      if (!isObj(t) || (t.type !== undefined && t.type !== "custom")) throw bad(`tools[${i}]: only custom tools are allowed.`);
      if (typeof t.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(t.name)) throw bad(`tools[${i}].name is invalid.`);
      if (typeof t.description !== "string" || t.description.length > L.maxToolDescriptionChars) throw bad(`tools[${i}].description is missing or too long.`);
      if (!isObj(t.input_schema) || JSON.stringify(t.input_schema).length > L.maxToolSchemaBytes) throw bad(`tools[${i}].input_schema is missing or too large.`);
      return { name: t.name, description: t.description, input_schema: t.input_schema };
    });
  }

  const requested = typeof raw.max_tokens === "number" && Number.isInteger(raw.max_tokens) && raw.max_tokens > 0 ? raw.max_tokens : L.maxTokens;
  return { system, messages, tools, maxTokens: Math.min(requested, L.maxTokens) };
}
