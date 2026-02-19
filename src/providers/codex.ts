/** Forwards requests to chatgpt.com/backend-api/codex with Codex CLI OAuth token.
 *
 *  The ChatGPT backend only accepts the Responses API format (input[] + instructions),
 *  but Amp CLI sends Chat Completions format (messages[]). This module transforms
 *  the request body before forwarding. */

import { codex as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { CODEX_BASE_URL, codexHeaders, codexHeaderValues, codexPathMap } from "../constants.ts";
import { fromBase64url } from "../utils/encoding.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./base.ts";
import { transformCodexResponse } from "./codex-sse.ts";

const DEFAULT_INSTRUCTIONS = "You are an expert coding assistant.";

export const provider: Provider = {
  name: "OpenAI Codex",
  routeDecision: "LOCAL_CODEX",

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("codex", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, _originalHeaders, rewrite, account = 0) {
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("OpenAI Codex");

    const accountId = getAccountId(accessToken, account);
    const codexPath = codexPathMap[sub] ?? sub;
    const { body: codexBody, needsResponseTransform } = transformForCodex(body.forwardBody);
    const ampModel = body.ampModel ?? "gpt-5.2";

    const response = await forward({
      url: `${CODEX_BASE_URL}${codexPath}`,
      body: codexBody,
      streaming: body.stream,
      providerName: "OpenAI Codex",
      // Skip generic rewrite when we need full response transform
      rewrite: needsResponseTransform ? undefined : rewrite,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Accept: body.stream ? "text/event-stream" : "application/json",
        Connection: "Keep-Alive",
        [codexHeaders.BETA]: codexHeaderValues.BETA_RESPONSES,
        [codexHeaders.ORIGINATOR]: codexHeaderValues.ORIGINATOR,
        "User-Agent": codexHeaderValues.USER_AGENT,
        Version: codexHeaderValues.VERSION,
        ...(accountId ? { [codexHeaders.ACCOUNT_ID]: accountId } : {}),
      },
    });

    // Transform Responses API SSE → Chat Completions SSE when original was messages[] format
    if (needsResponseTransform && response.ok) {
      return transformCodexResponse(response, ampModel);
    }
    return response;
  },
};

// ---------------------------------------------------------------------------
// Body transformation: Chat Completions → Responses API
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: string;
  content: unknown;
  tool_calls?: ToolCallItem[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCallItem {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

function transformForCodex(rawBody: string): { body: string; needsResponseTransform: boolean } {
  if (!rawBody) return { body: rawBody, needsResponseTransform: false };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { body: rawBody, needsResponseTransform: false };
  }

  // Convert Chat Completions messages[] → Responses API input[]
  let needsResponseTransform = false;
  if (Array.isArray(parsed.messages) && !parsed.input) {
    const { instructions, input } = convertMessages(parsed.messages as ChatMessage[]);
    parsed.input = input;
    parsed.instructions = parsed.instructions ?? instructions ?? DEFAULT_INSTRUCTIONS;
    delete parsed.messages;
    needsResponseTransform = true;
  }

  // Already Responses API format — ensure instructions exists
  if (!parsed.instructions) {
    parsed.instructions = extractInstructionsFromInput(parsed) ?? DEFAULT_INSTRUCTIONS;
  }

  // Codex backend requirements
  parsed.store = false;
  parsed.stream = true;

  // Strip id fields from input items
  if (Array.isArray(parsed.input)) {
    stripInputIds(parsed.input as Record<string, unknown>[]);
  }

  // Remove fields the Codex backend doesn't accept
  delete parsed.max_tokens;
  delete parsed.max_completion_tokens;
  // Chat Completions fields not in Responses API
  delete parsed.frequency_penalty;
  delete parsed.logprobs;
  delete parsed.top_logprobs;
  delete parsed.n;
  delete parsed.presence_penalty;
  delete parsed.seed;
  delete parsed.stop;
  delete parsed.logit_bias;
  delete parsed.response_format;

  return { body: JSON.stringify(parsed), needsResponseTransform };
}

/** Convert Chat Completions messages[] → Responses API input[] + instructions. */
function convertMessages(messages: ChatMessage[]): { instructions: string | null; input: unknown[] } {
  let instructions: string | null = null;
  const input: unknown[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
      case "developer": {
        // First system message → instructions; additional ones → developer input items
        const text = textOf(msg.content);
        if (!instructions) {
          instructions = text;
        } else if (text) {
          input.push({ role: "developer", content: [{ type: "input_text", text }] });
        }
        break;
      }

      case "user":
        input.push({ role: "user", content: convertUserContent(msg.content) });
        break;

      case "assistant": {
        // Text content → message output item
        const text = textOf(msg.content);
        if (text) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text, annotations: [] }],
            status: "completed",
          });
        }
        // Tool calls → function_call items
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            input.push({
              type: "function_call",
              call_id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }
        break;
      }

      case "tool":
        // Tool result → function_call_output
        input.push({
          type: "function_call_output",
          call_id: msg.tool_call_id,
          output: textOf(msg.content) ?? "",
        });
        break;
    }
  }

  return { instructions, input };
}

/** Convert user message content to Responses API format. */
function convertUserContent(content: unknown): unknown[] {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }
  if (Array.isArray(content)) {
    return content.map((part: Record<string, unknown>) => {
      if (part.type === "text") {
        return { type: "input_text", text: part.text };
      }
      if (part.type === "image_url") {
        const imageUrl = part.image_url as Record<string, unknown>;
        return { type: "input_image", image_url: imageUrl.url, detail: imageUrl.detail ?? "auto" };
      }
      return part;
    });
  }
  return [{ type: "input_text", text: String(content) }];
}

/** Extract text from content (string or array). */
function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c: Record<string, unknown>) => c.type === "text" || c.type === "input_text")
      .map((c: Record<string, unknown>) => c.text as string);
    return texts.length > 0 ? texts.join("\n") : null;
  }
  return null;
}

/** Extract instructions from system/developer messages already in input[]. */
function extractInstructionsFromInput(parsed: Record<string, unknown>): string | null {
  const input = parsed.input;
  if (!Array.isArray(input)) return null;

  for (let i = 0; i < input.length; i++) {
    const item = input[i] as Record<string, unknown>;
    if (item.role === "system" || item.role === "developer") {
      const text = textOf(item.content);
      if (text) {
        input.splice(i, 1);
        return text;
      }
    }
  }
  return null;
}

/** Strip `id` fields from input items — Codex backend rejects them. */
function stripInputIds(items: Record<string, unknown>[]): void {
  for (const item of items) {
    if ("id" in item) {
      delete item.id;
    }
  }
}

/** Extract chatgpt_account_id from JWT, falling back to stored credentials. */
function getAccountId(accessToken: string, account: number): string | undefined {
  const creds = store.get("codex", account);
  if (creds?.accountId) return creds.accountId;

  try {
    const parts = accessToken.split(".");
    if (parts.length < 2 || !parts[1]) return undefined;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    return (auth?.chatgpt_account_id as string) ?? undefined;
  } catch {
    return undefined;
  }
}
