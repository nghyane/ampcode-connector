/** Forwards requests to chatgpt.com/backend-api/codex with Codex CLI OAuth token.
 *
 *  The ChatGPT backend only accepts the Responses API format (input[] + instructions),
 *  but Amp CLI sends Chat Completions format (messages[]). This module transforms
 *  the request body before forwarding.
 *
 *  Forward flow (5 steps):
 *    1. AUTH    — acquire OAuth access token
 *    2. EXPAND  — resolve previous_response_id → full input (codex-state)
 *    3. PREPARE — transform body for Codex backend
 *    4. FORWARD — send to Codex backend
 *    5. PROCESS — format response + capture state for future turns */

import { codex as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { CODEX_BASE_URL, codexHeaders, codexHeaderValues, codexPathMap } from "../constants.ts";
import { fromBase64url } from "../utils/encoding.ts";
import { logger } from "../utils/logger.ts";
import { apiError } from "../utils/responses.ts";
import type { Provider } from "./base.ts";
import { bufferCodexResponse, transformCodexResponse } from "./codex-sse.ts";
import * as state from "./codex-state.ts";
import { denied, forward } from "./forward.ts";

const DEFAULT_INSTRUCTIONS = "You are an expert coding assistant.";

export const provider: Provider = {
  name: "OpenAI Codex",
  routeDecision: "LOCAL_CODEX",

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("codex", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, originalHeaders, rewrite, account = 0) {
    // 1. AUTH
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("OpenAI Codex");

    const accountId = getAccountId(accessToken, account);
    const codexPath = codexPathMap[sub] ?? sub;
    const promptCacheKey = originalHeaders.get("x-amp-thread-id") ?? originalHeaders.get("x-session-id") ?? undefined;

    // 2. EXPAND — resolve previous_response_id before body transform
    const expandedBody = expandPreviousResponse(body.forwardBody);
    if (expandedBody === null) {
      return apiError(400, "previous_response_id references an unknown or expired response");
    }

    // 3. PREPARE — transform body for Codex backend
    const {
      body: codexBody,
      needsResponseTransform,
      expandedInput,
      instructions,
    } = transformForCodex(expandedBody, promptCacheKey);
    const ampModel = body.ampModel ?? "gpt-5.2";

    // 4. FORWARD
    const response = await forward({
      url: `${CODEX_BASE_URL}${codexPath}`,
      body: codexBody,
      streaming: body.stream,
      providerName: "OpenAI Codex",
      rewrite: needsResponseTransform ? undefined : rewrite,
      email: store.get("codex", account)?.email,
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
        ...(promptCacheKey
          ? { [codexHeaders.SESSION_ID]: promptCacheKey, [codexHeaders.CONVERSATION_ID]: promptCacheKey }
          : {}),
      },
    });

    // 5. PROCESS — format response + capture state
    if (!response.ok) return response;

    // Chat Completions path — transform only, no state capture
    if (needsResponseTransform) {
      return body.stream ? transformCodexResponse(response, ampModel) : bufferCodexResponse(response, ampModel);
    }

    // Responses API path — capture state + format
    return body.stream
      ? processStreamingResponse(response, expandedInput, instructions)
      : processBufferedResponse(response, expandedInput, instructions);
  },
};

// ---------------------------------------------------------------------------
// Step 2: Expand previous_response_id
// ---------------------------------------------------------------------------

/** Resolve previous_response_id into expanded input. Returns the (possibly modified) body string,
 *  or null if the referenced response was not found. */
function expandPreviousResponse(rawBody: string): string | null {
  if (!rawBody) return rawBody;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return rawBody;
  }

  const prevId = parsed.previous_response_id as string | undefined;
  if (!prevId) return rawBody;

  const currentInput = Array.isArray(parsed.input) ? (parsed.input as unknown[]) : [];
  const currentInstructions = (parsed.instructions as string) ?? null;
  const expanded = state.expand(prevId, currentInput, currentInstructions);
  if (!expanded) {
    logger.warn(`previous_response_id "${prevId}" not found in state store`);
    return null;
  }

  parsed.input = expanded.input;
  if (expanded.instructions) parsed.instructions = expanded.instructions;
  delete parsed.previous_response_id;

  logger.debug(`Expanded previous_response_id "${prevId}", input items: ${expanded.input.length}`);
  return JSON.stringify(parsed);
}

// ---------------------------------------------------------------------------
// Step 5: Response processing with state capture
// ---------------------------------------------------------------------------

/** Streaming Responses API: pass through SSE + capture state from response.completed. */
function processStreamingResponse(response: Response, expandedInput: unknown[], instructions: string | null): Response {
  if (!response.body) return response;

  const body = state.withStateCapture(response.body, expandedInput, instructions);
  return new Response(body, { status: response.status, headers: response.headers });
}

/** Non-streaming Responses API: buffer SSE → JSON + capture state. */
async function processBufferedResponse(
  response: Response,
  expandedInput: unknown[],
  instructions: string | null,
): Promise<Response> {
  const fullResponse = await state.bufferResponseJson(response);
  if (!fullResponse) {
    return apiError(502, "No response received from Codex backend");
  }

  // Capture state for future previous_response_id lookups
  if (fullResponse.id) {
    const output = Array.isArray(fullResponse.output) ? (fullResponse.output as unknown[]) : [];
    state.store(fullResponse.id as string, expandedInput, output, instructions);
  }

  return new Response(JSON.stringify(fullResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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

function clampReasoningEffort(model: string, effort: string): string {
  const modelId = model.includes("/") ? model.split("/").pop()! : model;
  if (modelId === "gpt-5.1" && effort === "xhigh") return "high";
  if ((modelId.startsWith("gpt-5.2") || modelId.startsWith("gpt-5.3")) && effort === "minimal") return "low";
  if (modelId === "gpt-5.1-codex-mini") {
    return effort === "high" || effort === "xhigh" ? "high" : "medium";
  }
  return effort;
}

interface TransformResult {
  body: string;
  needsResponseTransform: boolean;
  /** The input[] sent to Codex — used for state capture. */
  expandedInput: unknown[];
  /** The instructions sent to Codex — used for state capture. */
  instructions: string | null;
}

function transformForCodex(rawBody: string, promptCacheKey?: string): TransformResult {
  const empty: TransformResult = {
    body: rawBody,
    needsResponseTransform: false,
    expandedInput: [],
    instructions: null,
  };
  if (!rawBody) return empty;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return empty;
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

  // Snapshot input + instructions for state capture (before Codex-specific mutations)
  const expandedInput = Array.isArray(parsed.input) ? [...(parsed.input as unknown[])] : [];
  const instructions = (parsed.instructions as string) ?? null;

  // Codex backend requirements
  parsed.store = false;
  parsed.stream = true;

  // Strip id fields from input items
  if (Array.isArray(parsed.input)) {
    stripInputIds(parsed.input as Record<string, unknown>[]);
    fixOrphanOutputs(parsed.input as Record<string, unknown>[]);
  }

  // Reasoning config — merge with caller-provided values, defaults match reference behavior
  // Chat Completions uses top-level "reasoning_effort"; Responses API uses "reasoning.effort"
  const model = (parsed.model as string) ?? "";
  const existingReasoning = (parsed.reasoning as Record<string, unknown>) ?? {};
  const topLevelEffort = parsed.reasoning_effort as string | undefined;
  parsed.reasoning = {
    effort: clampReasoningEffort(model, topLevelEffort ?? (existingReasoning.effort as string) ?? "medium"),
    summary: existingReasoning.summary ?? "auto",
  };

  const existingText = (parsed.text as Record<string, unknown>) ?? {};
  parsed.text = { ...existingText, verbosity: existingText.verbosity ?? "medium" };

  const existingInclude = Array.isArray(parsed.include) ? (parsed.include as string[]) : [];
  if (!existingInclude.includes("reasoning.encrypted_content")) {
    existingInclude.push("reasoning.encrypted_content");
  }
  parsed.include = existingInclude;

  if (promptCacheKey) {
    parsed.prompt_cache_key = promptCacheKey;
  }

  // Remove fields the Codex backend doesn't accept
  delete parsed.reasoning_effort; // Chat Completions field; already mapped to reasoning.effort above
  delete parsed.prompt_cache_retention;
  delete parsed.safety_identifier;
  delete parsed.stream_options; // Chat Completions streaming option; Codex Responses backend rejects it
  delete parsed.max_tokens;
  delete parsed.max_completion_tokens;
  delete parsed.max_output_tokens;
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

  // Normalize tools[] for Responses API: flatten function.{name,description,parameters,strict} to top-level
  if (Array.isArray(parsed.tools)) {
    parsed.tools = (parsed.tools as Record<string, unknown>[]).map((tool) => {
      if (tool.type === "function" && tool.function && typeof tool.function === "object") {
        const fn = tool.function as Record<string, unknown>;
        return {
          type: "function",
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
          ...(fn.strict !== undefined ? { strict: fn.strict } : {}),
        };
      }
      return tool;
    });
  }

  // Normalize tool_choice for Responses API
  if (parsed.tool_choice !== undefined && parsed.tool_choice !== null) {
    if (typeof parsed.tool_choice === "string") {
      // "auto", "none", "required" pass through as-is
    } else if (typeof parsed.tool_choice === "object") {
      const tc = parsed.tool_choice as Record<string, unknown>;
      if (tc.type === "function" && tc.function) {
        const fn = tc.function as Record<string, unknown>;
        parsed.tool_choice = { type: "function", name: fn.name };
      } else if (tc.type === "tool" && tc.name) {
        parsed.tool_choice = { type: "function", name: tc.name };
      }
    }
  }

  return { body: JSON.stringify(parsed), needsResponseTransform, expandedInput, instructions };
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
          output: stringifyContent(msg.content),
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

/** Convert content to string, with JSON fallback for non-text values. */
function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  const text = textOf(content);
  if (text !== null) return text;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
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

/** Convert orphan function_call_output items (no matching function_call) to assistant messages. */
function fixOrphanOutputs(items: Record<string, unknown>[]): void {
  const callIds = new Set(
    items.filter((i) => i.type === "function_call" && typeof i.call_id === "string").map((i) => i.call_id as string),
  );
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.type === "function_call_output" && typeof item.call_id === "string" && !callIds.has(item.call_id)) {
      const toolName = typeof item.name === "string" ? (item.name as string) : "tool";
      let text = "";
      try {
        text = typeof item.output === "string" ? (item.output as string) : JSON.stringify(item.output);
      } catch {
        text = String(item.output ?? "");
      }
      if (text.length > 16000) {
        text = `${text.slice(0, 16000)}\n...[truncated]`;
      }
      items[i] = {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: `[Previous ${toolName} result; call_id=${item.call_id}]: ${text}`,
            annotations: [],
          },
        ],
        status: "completed",
      };
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
