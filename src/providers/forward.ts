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

function createCodexResponseBackfill(rewrite?: (data: string) => string): (data: string) => string {
  const outputItemsByIndex = new Map<number, unknown>();
  const outputItemsFallback: unknown[] = [];

  return (data: string): string => {
    const patched = backfillCodexCompletedOutput(data, outputItemsByIndex, outputItemsFallback);
    return rewrite ? rewrite(patched) : patched;
  };
}

function backfillCodexCompletedOutput(
  data: string,
  outputItemsByIndex: Map<number, unknown>,
  outputItemsFallback: unknown[],
): string {
  if (data === "[DONE]") return data;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return data;
  }

  const eventType = parsed.type as string | undefined;

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
  const hasNoOutput = !Array.isArray(output) || output.length === 0;
  const hasBackfillItems = outputItemsByIndex.size > 0 || outputItemsFallback.length > 0;
  if (!hasNoOutput || !hasBackfillItems) return data;

  response.output = [
    ...Array.from(outputItemsByIndex.entries())
      .sort(([a], [b]) => a - b)
      .map(([, item]) => item),
    ...outputItemsFallback,
  ];

  return JSON.stringify(parsed);
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
