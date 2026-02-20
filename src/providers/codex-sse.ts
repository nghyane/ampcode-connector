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
}

interface TransformState {
  responseId: string;
  model: string;
  created: number;
  toolCallIndex: number;
  /** Track active tool call IDs to assign sequential indices. */
  toolCallIds: Map<string, number>;
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
    if (data === "[DONE]") return data;

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
          const name = item.name as string;
          const idx = state.toolCallIndex++;
          state.toolCallIds.set(callId, idx);
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
        const callId = parsed.call_id as string | undefined;
        if (delta) {
          const idx = callId ? (state.toolCallIds.get(callId) ?? 0) : 0;
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

      // Reasoning/thinking delta — emit as content (Amp shows thinking)
      case "response.reasoning_summary_text.delta": {
        const delta = parsed.delta as string;
        if (delta) return serialize(state, { content: delta });
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

function extractUsage(raw: Record<string, unknown> | undefined): Usage | undefined {
  if (!raw) return undefined;
  const input = (raw.input_tokens as number) ?? 0;
  const output = (raw.output_tokens as number) ?? 0;
  const cached = (raw.input_tokens_details as Record<string, unknown>)?.cached_tokens as number | undefined;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
    ...(cached !== undefined ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
  };
}

/** Wrap a Codex SSE response with the Responses → Chat Completions transformer.
 *  Strips Responses API event names so output looks like standard Chat Completions SSE. */
export function transformCodexResponse(response: Response, ampModel: string): Response {
  if (!response.body) return response;

  const transformer = createResponseTransformer(ampModel);
  const body = transformStream(response.body, transformer);

  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
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
