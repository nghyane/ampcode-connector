/** Provider interface and shared request forwarding. */

import type { RouteDecision } from "../utils/logger.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import * as sse from "../utils/streaming.ts";

export interface Provider {
  readonly name: string;
  readonly routeDecision: RouteDecision;
  isAvailable(): boolean;
  forward(path: string, body: string, headers: Headers, rewrite?: (data: string) => string): Promise<Response>;
}

interface ForwardOptions {
  url: string;
  body: string;
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

  const isSSE = response.headers.get("Content-Type")?.includes("text/event-stream") || path.streaming(opts.body);
  if (isSSE) return sse.proxy(response, opts.rewrite);

  if (!response.ok) {
    const text = await response.text();
    logger.error(`${opts.providerName} API error`, { error: text.slice(0, 200) });
    return new Response(text, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  }

  if (opts.rewrite) {
    const text = await response.text();
    return new Response(opts.rewrite(text), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}

export function denied(providerName: string): Response {
  return new Response(JSON.stringify({ error: `No ${providerName} OAuth token available. Run login first.` }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
