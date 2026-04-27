/** HTTP forwarding with transport-level retry, SSE proxying, and response rewriting. */

import { logger } from "../utils/logger.ts";
import { apiError } from "../utils/responses.ts";
import * as sse from "../utils/streaming.ts";

export interface ForwardOptions {
  url: string;
  body: string;
  streaming: boolean;
  headers: Record<string, string>;
  providerName: string;
  rewrite?: (data: string) => string;
  email?: string;
}

const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const PASSTHROUGH_HEADERS = [
  "content-type",
  "retry-after",
  "x-request-id",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
];

function copyHeaders(source: Headers): Headers {
  const dest = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = source.get(name);
    if (value !== null) dest.set(name, value);
  }
  return dest;
}

export async function forward(opts: ForwardOptions): Promise<Response> {
  const requestBody = sanitizeForwardBody(opts);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(opts.url, {
        method: "POST",
        headers: opts.headers,
        body: requestBody,
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        logger.debug(`${opts.providerName} fetch error, retry ${attempt + 1}/${MAX_RETRIES}`, {
          error: String(err),
        });
        await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      return transportErrorResponse(opts.providerName, err);
    }

    // Retry on server errors (429 handled at routing layer)
    if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
      await response.text(); // consume body
      logger.debug(`${opts.providerName} returned ${response.status}, retry ${attempt + 1}/${MAX_RETRIES}`);
      await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }

    const contentType = response.headers.get("Content-Type") ?? "application/json";

    if (!response.ok) {
      const text = await response.text();
      const ctx = opts.email ? ` account=${opts.email}` : "";
      logger.error(`${opts.providerName} API error (${response.status})${ctx}`, { error: text.slice(0, 200) });

      // Normalize non-standard error responses (e.g. {"detail":"..."}) to OpenAI format
      // so Amp CLI can deserialize them (it expects {"error": {...}})
      let errorBody = text;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (!parsed.error) {
          const message = (parsed.detail as string) ?? (parsed.message as string) ?? text;
          errorBody = JSON.stringify({
            error: { message, type: "api_error", code: String(response.status) },
          });
        }
      } catch {
        // Not JSON — wrap raw text
        errorBody = JSON.stringify({
          error: { message: text, type: "api_error", code: String(response.status) },
        });
      }

      const headers = copyHeaders(response.headers);
      headers.set("Content-Type", "application/json");
      return new Response(errorBody, {
        status: response.status,
        headers,
      });
    }

    const isSSE = contentType.includes("text/event-stream") || opts.streaming;
    if (isSSE) {
      const streamRewrite =
        opts.providerName === "OpenAI Codex" ? createCodexResponseBackfill(opts.rewrite) : opts.rewrite;
      return sse.proxy(response, streamRewrite);
    }

    const headers = copyHeaders(response.headers);

    if (opts.rewrite) {
      const text = await response.text();
      return new Response(opts.rewrite(text), { status: response.status, headers });
    }

    return new Response(response.body, { status: response.status, headers });
  }

  // Unreachable, but TypeScript needs it
  throw new Error(`${opts.providerName}: all retries exhausted`);
}

export function denied(providerName: string): Response {
  return apiError(401, `No ${providerName} OAuth token available. Run login first.`);
}

function sanitizeForwardBody(opts: ForwardOptions): string {
  if (opts.providerName !== "OpenAI Codex" || !hasUnsupportedCodexRequestField(opts.body)) return opts.body;

  try {
    const parsed = JSON.parse(opts.body) as Record<string, unknown>;
    delete parsed.prompt_cache_retention;
    delete parsed.safety_identifier;
    delete parsed.stream_options;
    return JSON.stringify(parsed);
  } catch {
    return opts.body;
  }
}

function hasUnsupportedCodexRequestField(body: string): boolean {
  return (
    body.includes("prompt_cache_retention") || body.includes("safety_identifier") || body.includes("stream_options")
  );
}

interface MessageOutputDraft {
  id?: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "output_text"; text: string; annotations: unknown[] }>;
  status: "completed";
}

function createCodexResponseBackfill(rewrite?: (data: string) => string): (data: string) => string {
  const outputItemsByIndex = new Map<number, unknown>();
  const outputItemsFallback: unknown[] = [];
  const messageDraftsByIndex = new Map<number, MessageOutputDraft>();

  return (data: string): string => {
    const patched = backfillCodexCompletedOutput(data, outputItemsByIndex, outputItemsFallback, messageDraftsByIndex);
    return rewrite ? rewrite(patched) : patched;
  };
}

function backfillCodexCompletedOutput(
  data: string,
  outputItemsByIndex: Map<number, unknown>,
  outputItemsFallback: unknown[],
  messageDraftsByIndex: Map<number, MessageOutputDraft>,
): string {
  if (data === "[DONE]") return data;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return data;
  }

  const eventType = parsed.type as string | undefined;

  collectCodexMessageDraft(parsed, messageDraftsByIndex);

  if (eventType === "response.output_item.done") {
    const item = parsed.item;
    if (!item || typeof item !== "object") return data;

    const outputIndex = parsed.output_index;
    if (typeof outputIndex === "number") {
      outputItemsByIndex.set(outputIndex, item);
    } else {
      outputItemsFallback.push(item);
    }
    return data;
  }

  if (eventType !== "response.completed") return data;

  const response = parsed.response as Record<string, unknown> | undefined;
  if (!response) return data;

  const output = response.output;
  const existingOutput = Array.isArray(output) ? output : [];
  const backfillItems = orderedBackfillItems(outputItemsByIndex, outputItemsFallback, messageDraftsByIndex);
  if (backfillItems.length === 0) return data;

  const hasMessageOutput = existingOutput.some(isMessageOutput);
  const hasBackfillMessage = backfillItems.some(isMessageOutput);
  const shouldBackfillEmptyOutput = existingOutput.length === 0;
  const shouldBackfillMissingMessage = !hasMessageOutput && hasBackfillMessage;
  if (!shouldBackfillEmptyOutput && !shouldBackfillMissingMessage) return data;

  response.output = shouldBackfillEmptyOutput ? backfillItems : mergeOutputItems(existingOutput, backfillItems);

  return JSON.stringify(parsed);
}

function collectCodexMessageDraft(
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

function orderedBackfillItems(
  outputItemsByIndex: Map<number, unknown>,
  outputItemsFallback: unknown[],
  messageDraftsByIndex: Map<number, MessageOutputDraft>,
): unknown[] {
  const indexedItems = new Map(outputItemsByIndex);
  for (const [index, draft] of messageDraftsByIndex) {
    if (!indexedItems.has(index) && draft.content.some((part) => part.text.length > 0)) {
      indexedItems.set(index, draft);
    }
  }

  return [
    ...Array.from(indexedItems.entries())
      .sort(([a], [b]) => a - b)
      .map(([, item]) => item),
    ...outputItemsFallback,
  ];
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

function transportErrorResponse(providerName: string, err: unknown): Response {
  const message = transportErrorMessage(providerName, err);
  logger.error(`${providerName} transport error after retries exhausted`, { error: String(err) });
  return apiError(502, message, "connection_error");
}

function transportErrorMessage(providerName: string, err: unknown): string {
  const base = `${providerName} connection error after retries were exhausted.`;
  const details = String(err);

  if (providerName !== "Anthropic") {
    return `${base} ${details}`;
  }

  const looksLikeReset =
    details.includes("ECONNRESET") ||
    details.includes("socket connection was closed unexpectedly") ||
    details.includes("tls") ||
    details.includes("network");

  if (!looksLikeReset) {
    return `${base} ${details}`;
  }

  return `${base} ${details} This is often a local network issue rather than an OAuth bug: check Wi-Fi MTU (1492 is a common fix), hotspot stability, and iPhone dual-SIM Cellular Data Switching if you are tethering.`;
}
