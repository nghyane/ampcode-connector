/** Transforms Responses API SSE events → Chat Completions SSE chunks.
 *
 *  Codex backend returns Responses API format (response.output_text.delta, etc.)
 *  but Amp CLI expects Chat Completions format (chat.completion.chunk). */

import * as sse from "../utils/streaming.ts";

interface CompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Choice[];
  usage?: Usage | null;
}

interface Choice {
  index: number;
  delta: Delta;
  finish_reason: string | null;
}

interface Delta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: ToolCallDelta[];
}

interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

interface TransformState {
  responseId: string;
  model: string;
  created: number;
  toolCallIndex: number;
  /** Track active tool call IDs to assign sequential indices. */
  toolCallIds: Map<string, number>;
}

/** Resolve tool call index from item_id or call_id, falling back to 0. */
function lookupToolIndex(state: TransformState, itemId?: string, callId?: string): number {
  if (itemId) {
    const idx = state.toolCallIds.get(itemId);
    if (idx !== undefined) return idx;
  }
  if (callId) {
    const idx = state.toolCallIds.get(callId);
    if (idx !== undefined) return idx;
  }
  return 0;
}

/** Create a stateful SSE transformer: Responses API → Chat Completions. */
function createResponseTransformer(ampModel: string): (data: string) => string {
  const state: TransformState = {
    responseId: "",
    model: ampModel,
    created: Math.floor(Date.now() / 1000),
    toolCallIndex: 0,
    toolCallIds: new Map(),
  };

  return (data: string): string => {
    if (data === "[DONE]") return "";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return data;
    }

    const eventType = parsed.type as string | undefined;
    if (!eventType) return data;

    // Extract response metadata on creation
    if (eventType === "response.created") {
      const resp = parsed.response as Record<string, unknown>;
      state.responseId = (resp?.id as string) ?? state.responseId;
      state.model = ampModel;
      state.created = (resp?.created_at as number) ?? state.created;
      // Don't emit a chunk for response.created
      return "";
    }

    switch (eventType) {
      // Assistant message started — emit role
      case "response.output_item.added": {
        const item = parsed.item as Record<string, unknown>;
        if (item?.type === "message" && item.role === "assistant") {
          return serialize(state, { role: "assistant", content: "" });
        }
        if (item?.type === "function_call") {
          const callId = item.call_id as string;
          const itemId = item.id as string | undefined;
          const name = item.name as string;
          const idx = state.toolCallIndex++;
          state.toolCallIds.set(callId, idx);
          if (itemId) state.toolCallIds.set(itemId, idx);
          return serialize(state, {
            tool_calls: [{ index: idx, id: callId, type: "function", function: { name, arguments: "" } }],
          });
        }
        return "";
      }

      // Text content delta
      case "response.output_text.delta": {
        const delta = parsed.delta as string;
        if (delta) return serialize(state, { content: delta });
        return "";
      }

      // Function call arguments delta
      case "response.function_call_arguments.delta": {
        const delta = parsed.delta as string;
        const itemId = parsed.item_id as string | undefined;
        const callId = parsed.call_id as string | undefined;
        if (delta) {
          const idx = lookupToolIndex(state, itemId, callId);
          return serialize(state, { tool_calls: [{ index: idx, function: { arguments: delta } }] });
        }
        return "";
      }

      // Response completed — emit finish_reason + usage
      case "response.completed": {
        const resp = parsed.response as Record<string, unknown>;
        const usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
        const hasToolCalls = state.toolCallIndex > 0;
        const finishReason = hasToolCalls ? "tool_calls" : "stop";
        return serializeFinish(state, finishReason, usage);
      }

      // Response incomplete — inspect reason to determine finish_reason
      case "response.incomplete": {
        const resp = parsed.response as Record<string, unknown>;
        const usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
        const finishReason = incompleteReason(resp);
        return serializeFinish(state, finishReason, usage);
      }

      // Response failed — emit error content so the client sees the failure
      case "response.failed": {
        const resp = parsed.response as Record<string, unknown>;
        const usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
        const errorMsg = extractErrorMessage(resp);
        let chunks = "";
        if (errorMsg) {
          chunks = serialize(state, { role: "assistant", content: `[Error] ${errorMsg}` });
          chunks += "\n\n";
        }
        chunks += serializeFinish(state, "stop", usage);
        return chunks;
      }

      // Reasoning/thinking delta — emit as reasoning_content (separate from content)
      case "response.reasoning_summary_text.delta": {
        const delta = parsed.delta as string;
        if (delta) return serialize(state, { reasoning_content: delta });
        return "";
      }

      // Events we can skip
      case "response.in_progress":
      case "response.output_item.done":
      case "response.content_part.added":
      case "response.content_part.done":
      case "response.output_text.done":
      case "response.function_call_arguments.done":
      case "response.reasoning_summary_part.added":
      case "response.reasoning_summary_part.done":
        return "";

      default:
        return "";
    }
  };
}

function serialize(state: TransformState, delta: Delta): string {
  const chunk: CompletionChunk = {
    id: `chatcmpl-${state.responseId}`,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: null }],
  };
  return JSON.stringify(chunk);
}

function serializeFinish(state: TransformState, finishReason: string, usage?: Usage): string {
  const chunk: CompletionChunk = {
    id: `chatcmpl-${state.responseId}`,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
  return JSON.stringify(chunk);
}

/** Map Responses API incomplete reason → Chat Completions finish_reason. */
function incompleteReason(resp: Record<string, unknown> | undefined): string {
  if (!resp) return "length";
  const reason = resp.incomplete_details as Record<string, unknown> | undefined;
  const type = reason?.reason as string | undefined;
  if (type === "max_output_tokens" || type === "max_tokens") return "length";
  if (type === "content_filter") return "content_filter";
  return "length";
}

/** Extract a human-readable error message from a failed response. */
function extractErrorMessage(resp: Record<string, unknown> | undefined): string | null {
  if (!resp) return null;
  const error = resp.error as Record<string, unknown> | undefined;
  if (!error) return null;
  const message = error.message as string | undefined;
  const code = error.code as string | undefined;
  if (message) return code ? `${code}: ${message}` : message;
  if (code) return code;
  return null;
}

function extractUsage(raw: Record<string, unknown> | undefined): Usage | undefined {
  if (!raw) return undefined;
  const input = (raw.input_tokens as number) ?? 0;
  const output = (raw.output_tokens as number) ?? 0;
  const cached = (raw.input_tokens_details as Record<string, unknown>)?.cached_tokens as number | undefined;
  const reasoning = (raw.output_tokens_details as Record<string, unknown>)?.reasoning_tokens as number | undefined;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
    ...(cached !== undefined ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
    ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
  };
}

const FORWARDED_HEADERS = [
  "x-request-id",
  "request-id",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
] as const;

/** Wrap a Codex SSE response with the Responses → Chat Completions transformer.
 *  Strips Responses API event names so output looks like standard Chat Completions SSE. */
export function transformCodexResponse(response: Response, ampModel: string): Response {
  if (!response.body) return response;

  const transformer = createResponseTransformer(ampModel);
  const body = transformStream(response.body, transformer);

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }

  return new Response(body, { status: response.status, headers });
}

/** Buffer a Codex SSE response into a single Chat Completions JSON response.
 *  Used when the client requests stream: false but the backend forces streaming. */
export async function bufferCodexResponse(response: Response, ampModel: string): Promise<Response> {
  if (!response.body) return response;

  const state: TransformState = {
    responseId: "",
    model: ampModel,
    created: Math.floor(Date.now() / 1000),
    toolCallIndex: 0,
    toolCallIds: new Map(),
  };

  let content = "";
  let reasoningContent = "";
  const toolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();
  let finishReason = "stop";
  let usage: Usage | undefined;

  const decoder = new TextDecoder();
  let sseBuffer = "";

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    const boundary = sseBuffer.lastIndexOf("\n\n");
    if (boundary === -1) continue;

    const complete = sseBuffer.slice(0, boundary + 2);
    sseBuffer = sseBuffer.slice(boundary + 2);

    for (const chunk of sse.parse(complete)) {
      if (chunk.data === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(chunk.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const eventType = parsed.type as string | undefined;
      if (!eventType) continue;

      if (eventType === "response.created") {
        const resp = parsed.response as Record<string, unknown>;
        state.responseId = (resp?.id as string) ?? state.responseId;
        state.created = (resp?.created_at as number) ?? state.created;
        continue;
      }

      switch (eventType) {
        case "response.output_text.delta": {
          const delta = parsed.delta as string;
          if (delta) content += delta;
          break;
        }

        case "response.reasoning_summary_text.delta": {
          const delta = parsed.delta as string;
          if (delta) reasoningContent += delta;
          break;
        }

        case "response.output_item.added": {
          const item = parsed.item as Record<string, unknown>;
          if (item?.type === "function_call") {
            const callId = item.call_id as string;
            const itemId = item.id as string | undefined;
            const name = item.name as string;
            const idx = state.toolCallIndex++;
            state.toolCallIds.set(callId, idx);
            if (itemId) state.toolCallIds.set(itemId, idx);
            toolCalls.set(idx, { id: callId, type: "function", function: { name, arguments: "" } });
          }
          break;
        }

        case "response.function_call_arguments.delta": {
          const delta = parsed.delta as string;
          const itemId = parsed.item_id as string | undefined;
          const callId = parsed.call_id as string | undefined;
          if (delta) {
            const idx = lookupToolIndex(state, itemId, callId);
            const tc = toolCalls.get(idx);
            if (tc) tc.function.arguments += delta;
          }
          break;
        }

        case "response.completed": {
          const resp = parsed.response as Record<string, unknown>;
          usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
          finishReason = state.toolCallIndex > 0 ? "tool_calls" : "stop";
          break;
        }

        case "response.incomplete": {
          const resp = parsed.response as Record<string, unknown>;
          usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
          finishReason = incompleteReason(resp);
          break;
        }

        case "response.failed": {
          const resp = parsed.response as Record<string, unknown>;
          usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
          const errorMsg = extractErrorMessage(resp);
          if (errorMsg) content += `[Error] ${errorMsg}`;
          break;
        }
      }
    }
  }

  // Process remaining buffer — reuse the same event handling as main loop
  if (sseBuffer.trim()) {
    for (const chunk of sse.parse(sseBuffer)) {
      if (chunk.data === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(chunk.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const eventType = parsed.type as string | undefined;
      if (!eventType) continue;

      switch (eventType) {
        case "response.output_text.delta": {
          const delta = parsed.delta as string;
          if (delta) content += delta;
          break;
        }
        case "response.reasoning_summary_text.delta": {
          const delta = parsed.delta as string;
          if (delta) reasoningContent += delta;
          break;
        }
        case "response.output_item.added": {
          const item = parsed.item as Record<string, unknown>;
          if (item?.type === "function_call") {
            const callId = item.call_id as string;
            const itemId = item.id as string | undefined;
            const name = item.name as string;
            const idx = state.toolCallIndex++;
            state.toolCallIds.set(callId, idx);
            if (itemId) state.toolCallIds.set(itemId, idx);
            toolCalls.set(idx, { id: callId, type: "function", function: { name, arguments: "" } });
          }
          break;
        }
        case "response.function_call_arguments.delta": {
          const delta = parsed.delta as string;
          const itemId = parsed.item_id as string | undefined;
          const callId = parsed.call_id as string | undefined;
          if (delta) {
            const idx = lookupToolIndex(state, itemId, callId);
            const tc = toolCalls.get(idx);
            if (tc) tc.function.arguments += delta;
          }
          break;
        }
        case "response.completed": {
          const resp = parsed.response as Record<string, unknown>;
          usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
          finishReason = state.toolCallIndex > 0 ? "tool_calls" : "stop";
          break;
        }
        case "response.incomplete": {
          const resp = parsed.response as Record<string, unknown>;
          usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
          finishReason = incompleteReason(resp);
          break;
        }
        case "response.failed": {
          const resp = parsed.response as Record<string, unknown>;
          usage = extractUsage(resp?.usage as Record<string, unknown> | undefined);
          const errorMsg = extractErrorMessage(resp);
          if (errorMsg) content += `[Error] ${errorMsg}`;
          break;
        }
      }
    }
  }

  const message: Record<string, unknown> = { role: "assistant", content: content || null };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  if (toolCalls.size > 0) {
    message.tool_calls = Array.from(toolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => tc);
  }

  const result = {
    id: `chatcmpl-${state.responseId}`,
    object: "chat.completion",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Custom SSE transform that strips event names (Chat Completions doesn't use them). */
function transformStream(source: ReadableStream<Uint8Array>, fn: (data: string) => string): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  let buffer = "";

  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(raw, controller) {
        buffer += decoder.decode(raw, { stream: true }).replaceAll("\r\n", "\n");
        const boundary = buffer.lastIndexOf("\n\n");
        if (boundary === -1) return;

        const complete = buffer.slice(0, boundary + 2);
        buffer = buffer.slice(boundary + 2);

        for (const chunk of sse.parse(complete)) {
          const transformed = fn(chunk.data);
          if (transformed) {
            // Emit without event name — standard Chat Completions format
            controller.enqueue(textEncoder.encode(`data: ${transformed}\n\n`));
          }
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          for (const chunk of sse.parse(buffer)) {
            const transformed = fn(chunk.data);
            if (transformed) {
              controller.enqueue(textEncoder.encode(`data: ${transformed}\n\n`));
            }
          }
        }
        // Emit [DONE] marker
        controller.enqueue(textEncoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}
