/** Provider interface and shared request forwarding. */

import type { ParsedBody } from "../server/body.ts";
import type { RouteDecision } from "../utils/logger.ts";
import { logger } from "../utils/logger.ts";
import * as sse from "../utils/streaming.ts";

export interface Provider {
  readonly name: string;
  readonly routeDecision: RouteDecision;
  isAvailable(account?: number): boolean;
  accountCount(): number;
  forward(
    path: string,
    body: ParsedBody,
    headers: Headers,
    rewrite?: (data: string) => string,
    account?: number,
  ): Promise<Response>;
}

interface ForwardOptions {
  url: string;
  body: string;
  streaming: boolean;
  headers: Record<string, string>;
  providerName: string;
  rewrite?: (data: string) => string;
}

export async function forward(opts: ForwardOptions): Promise<Response> {
  const response = await fetch(opts.url, {
    method: "POST",
    headers: opts.headers,
    body: opts.body,
  });

  const contentType = response.headers.get("Content-Type") ?? "application/json";

  if (!response.ok) {
    const text = await response.text();
    logger.error(`${opts.providerName} API error (${response.status})`, { error: text.slice(0, 200) });
    return new Response(text, { status: response.status, headers: { "Content-Type": contentType } });
  }

  const isSSE = contentType.includes("text/event-stream") || opts.streaming;
  if (isSSE) return sse.proxy(response, opts.rewrite);

  if (opts.rewrite) {
    const text = await response.text();
    return new Response(opts.rewrite(text), { status: response.status, headers: { "Content-Type": contentType } });
  }

  return new Response(response.body, { status: response.status, headers: { "Content-Type": contentType } });
}

export function denied(providerName: string): Response {
  return Response.json({ error: `No ${providerName} OAuth token available. Run login first.` }, { status: 401 });
}
