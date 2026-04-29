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

interface MessageOutputDraft {
  id?: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "output_text"; text: string; annotations: unknown[] }>;
  status: "completed";
}

interface OutputBackfillState {
  outputItemsByIndex: Map<number, unknown>;
  outputItemsFallback: unknown[];
  messageDraftsByIndex: Map<number, MessageOutputDraft>;
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
  const backfillState = createOutputBackfillState();

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    const boundary = sseBuffer.lastIndexOf("\n\n");
    if (boundary === -1) continue;

    const complete = sseBuffer.slice(0, boundary + 2);
    sseBuffer = sseBuffer.slice(boundary + 2);
    fullResponse = extractCompleted(complete, backfillState) ?? fullResponse;
  }

  if (sseBuffer.trim()) {
    fullResponse = extractCompleted(sseBuffer, backfillState) ?? fullResponse;
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

function extractCompleted(raw: string, backfillState = createOutputBackfillState()): Record<string, unknown> | null {
  for (const chunk of sse.parse(raw)) {
    if (chunk.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(chunk.data) as Record<string, unknown>;
      const type = parsed.type as string | undefined;
      collectOutputBackfill(parsed, backfillState);
      if (type === "response.completed" || type === "response.failed") {
        const response = (parsed.response as Record<string, unknown>) ?? null;
        return response ? backfillCompletedOutput(response, backfillState) : null;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

function createOutputBackfillState(): OutputBackfillState {
  return {
    outputItemsByIndex: new Map(),
    outputItemsFallback: [],
    messageDraftsByIndex: new Map(),
  };
}

function collectOutputBackfill(parsed: Record<string, unknown>, state: OutputBackfillState): void {
  collectMessageDraft(parsed, state.messageDraftsByIndex);

  if (parsed.type !== "response.output_item.done") return;
  const item = parsed.item;
  if (!item || typeof item !== "object") return;

  const outputIndex = parsed.output_index;
  if (typeof outputIndex === "number") {
    state.outputItemsByIndex.set(outputIndex, item);
  } else {
    state.outputItemsFallback.push(item);
  }
}

function collectMessageDraft(
  parsed: Record<string, unknown>,
  messageDraftsByIndex: Map<number, MessageOutputDraft>,
): void {
  const outputIndex = parsed.output_index;
  if (typeof outputIndex !== "number") return;

  const eventType = parsed.type as string | undefined;

  if (eventType === "response.output_item.added") {
    const item = parsed.item as Record<string, unknown> | undefined;
    if (item?.type === "message") {
      messageDraftsByIndex.set(outputIndex, {
        id: typeof item.id === "string" ? item.id : undefined,
        type: "message",
        role: "assistant",
        content: [],
        status: "completed",
      });
    }
    return;
  }

  if (eventType === "response.content_part.added" || eventType === "response.content_part.done") {
    const part = parsed.part as Record<string, unknown> | undefined;
    if (part?.type !== "output_text") return;
    setMessageDraftText(messageDraftsByIndex, outputIndex, parsed.content_index, part.text);
    return;
  }

  if (eventType === "response.output_text.delta") {
    appendMessageDraftText(messageDraftsByIndex, outputIndex, parsed.content_index, parsed.delta);
    return;
  }

  if (eventType === "response.output_text.done") {
    setMessageDraftText(messageDraftsByIndex, outputIndex, parsed.content_index, parsed.text);
  }
}

function appendMessageDraftText(
  messageDraftsByIndex: Map<number, MessageOutputDraft>,
  outputIndex: number,
  contentIndex: unknown,
  delta: unknown,
): void {
  if (typeof delta !== "string" || delta.length === 0) return;
  const part = ensureMessageDraftContent(messageDraftsByIndex, outputIndex, contentIndex);
  part.text += delta;
}

function setMessageDraftText(
  messageDraftsByIndex: Map<number, MessageOutputDraft>,
  outputIndex: number,
  contentIndex: unknown,
  text: unknown,
): void {
  if (typeof text !== "string") return;
  const part = ensureMessageDraftContent(messageDraftsByIndex, outputIndex, contentIndex);
  part.text = text;
}

function ensureMessageDraftContent(
  messageDraftsByIndex: Map<number, MessageOutputDraft>,
  outputIndex: number,
  contentIndex: unknown,
): { type: "output_text"; text: string; annotations: unknown[] } {
  let draft = messageDraftsByIndex.get(outputIndex);
  if (!draft) {
    draft = { type: "message", role: "assistant", content: [], status: "completed" };
    messageDraftsByIndex.set(outputIndex, draft);
  }

  const index = typeof contentIndex === "number" ? contentIndex : 0;
  draft.content[index] ??= { type: "output_text", text: "", annotations: [] };
  return draft.content[index]!;
}

function backfillCompletedOutput(
  response: Record<string, unknown>,
  state: OutputBackfillState,
): Record<string, unknown> {
  const output = response.output;
  const existingOutput = Array.isArray(output) ? output : [];
  const backfillItems = orderedBackfillItems(state);
  if (backfillItems.length === 0) return response;

  const hasMessageOutput = existingOutput.some(isMessageOutput);
  const hasBackfillMessage = backfillItems.some(isMessageOutput);
  const shouldBackfillEmptyOutput = existingOutput.length === 0;
  const shouldBackfillMissingMessage = !hasMessageOutput && hasBackfillMessage;
  if (!shouldBackfillEmptyOutput && !shouldBackfillMissingMessage) return response;

  response.output = shouldBackfillEmptyOutput ? backfillItems : mergeOutputItems(existingOutput, backfillItems);
  return response;
}

function orderedBackfillItems(state: OutputBackfillState): unknown[] {
  const indexedItems = new Map(state.outputItemsByIndex);
  for (const [index, draft] of state.messageDraftsByIndex) {
    const compactedDraft = compactMessageDraft(draft);
    if (!indexedItems.has(index) && compactedDraft.content.some((part) => part.text.length > 0)) {
      indexedItems.set(index, compactedDraft);
    }
  }

  return [
    ...Array.from(indexedItems.entries())
      .sort(([a], [b]) => a - b)
      .map(([, item]) => item),
    ...state.outputItemsFallback,
  ];
}

function compactMessageDraft(draft: MessageOutputDraft): MessageOutputDraft {
  return {
    ...draft,
    content: draft.content.filter((part) => part !== undefined),
  };
}

function isMessageOutput(item: unknown): boolean {
  return !!item && typeof item === "object" && (item as Record<string, unknown>).type === "message";
}

function mergeOutputItems(existingOutput: unknown[], backfillItems: unknown[]): unknown[] {
  const seenIds = new Set(
    existingOutput
      .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const merged = [...existingOutput];
  for (const item of backfillItems) {
    const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined;
    if (typeof id === "string" && id.length > 0) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    merged.push(item);
  }
  return merged;
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
