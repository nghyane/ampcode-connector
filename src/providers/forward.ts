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
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(opts.url, {
        method: "POST",
        headers: opts.headers,
        body: opts.body,
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        logger.debug(`${opts.providerName} fetch error, retry ${attempt + 1}/${MAX_RETRIES}`, {
          error: String(err),
        });
        await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
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
    if (isSSE) return sse.proxy(response, opts.rewrite);

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
