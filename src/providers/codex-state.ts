/** In-memory conversation state for Responses API previous_response_id support.
 *
 *  Each response is stored with its expanded input + output. When a follow-up
 *  request references previous_response_id, the stored input and output are
 *  prepended to build the full conversation context. Because we store the
 *  already-expanded input, recursive chains resolve in O(1) — no traversal. */

import * as sse from "../utils/streaming.ts";

const MAX_ENTRIES = 500;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredResponse {
  input: unknown[];
  output: unknown[];
  instructions: string | null;
  createdAt: number;
}

const responses = new Map<string, StoredResponse>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Store a completed response for future previous_response_id lookups. */
export function store(id: string, input: unknown[], output: unknown[], instructions: string | null): void {
  if (responses.size >= MAX_ENTRIES) evict();
  responses.set(id, { input, output, instructions, createdAt: Date.now() });
}

/** Expand previous_response_id: prepend stored context to current input.
 *  Returns null if the referenced response is not found (expired or invalid). */
export function expand(
  previousResponseId: string,
  currentInput: unknown[],
  currentInstructions: string | null,
): { input: unknown[]; instructions: string | null } | null {
  const stored = responses.get(previousResponseId);
  if (!stored) return null;
  if (Date.now() - stored.createdAt > TTL_MS) {
    responses.delete(previousResponseId);
    return null;
  }

  return {
    input: [...stored.input, ...stored.output, ...currentInput],
    instructions: currentInstructions ?? stored.instructions,
  };
}

// ---------------------------------------------------------------------------
// SSE response capture — extract id + output from Codex SSE stream
// ---------------------------------------------------------------------------

/** Extract the full response object from a Codex SSE stream (for non-streaming / buffer path).
 *  Returns the parsed response from `response.completed` or `response.failed`. */
export async function bufferResponseJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.body) return null;

  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullResponse: Record<string, unknown> | null = null;

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    const boundary = sseBuffer.lastIndexOf("\n\n");
    if (boundary === -1) continue;

    const complete = sseBuffer.slice(0, boundary + 2);
    sseBuffer = sseBuffer.slice(boundary + 2);
    fullResponse = extractCompleted(complete) ?? fullResponse;
  }

  if (sseBuffer.trim()) {
    fullResponse = extractCompleted(sseBuffer) ?? fullResponse;
  }

  return fullResponse;
}

/** Wrap a SSE stream to capture response state while passing all data through unchanged.
 *  Zero latency — chunks are forwarded immediately, state is captured as a side-effect
 *  when `response.completed` or `response.failed` passes through. */
export function withStateCapture(
  stream: ReadableStream<Uint8Array>,
  expandedInput: unknown[],
  instructions: string | null,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(raw, controller) {
        controller.enqueue(raw);

        buffer += decoder.decode(raw, { stream: true }).replaceAll("\r\n", "\n");
        const boundary = buffer.lastIndexOf("\n\n");
        if (boundary === -1) return;

        const complete = buffer.slice(0, boundary + 2);
        buffer = buffer.slice(boundary + 2);
        captureFromChunk(complete, expandedInput, instructions);
      },
      flush() {
        if (buffer.trim()) {
          captureFromChunk(buffer, expandedInput, instructions);
        }
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function captureFromChunk(raw: string, expandedInput: unknown[], instructions: string | null): void {
  for (const chunk of sse.parse(raw)) {
    if (chunk.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk.data) as Record<string, unknown>;
      const type = parsed.type as string | undefined;
      if (type === "response.completed" || type === "response.failed") {
        const resp = parsed.response as Record<string, unknown> | undefined;
        if (resp?.id) {
          const output = Array.isArray(resp.output) ? (resp.output as unknown[]) : [];
          store(resp.id as string, expandedInput, output, instructions);
        }
      }
    } catch {
      // Ignore unparseable chunks
    }
  }
}

function extractCompleted(raw: string): Record<string, unknown> | null {
  for (const chunk of sse.parse(raw)) {
    if (chunk.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk.data) as Record<string, unknown>;
      const type = parsed.type as string | undefined;
      if (type === "response.completed" || type === "response.failed") {
        return (parsed.response as Record<string, unknown>) ?? null;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

function evict(): void {
  const now = Date.now();
  for (const [key, value] of responses) {
    if (now - value.createdAt > TTL_MS) responses.delete(key);
  }
  // If still at capacity, remove oldest
  if (responses.size >= MAX_ENTRIES) {
    const first = responses.keys().next().value;
    if (first) responses.delete(first);
  }
}
