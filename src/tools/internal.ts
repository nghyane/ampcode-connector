/** Dispatcher for /api/internal?{method} — routes to local handlers or upstream. */

import type { ProxyConfig } from "../config/config.ts";
import * as upstream from "../proxy/upstream.ts";
import { logger } from "../utils/logger.ts";
import { handleWebRead } from "./web-read.ts";
import { handleSearch } from "./web-search.ts";

interface HandlerContext {
  params: Record<string, unknown>;
  config: ProxyConfig;
  forward: () => Promise<Response>;
}

type Handler = (ctx: HandlerContext) => Promise<Response>;

const handlers: Record<string, Handler> = {
  extractWebPageContent: async ({ params }) => {
    const url = str(params, "url");
    if (!url) return error("invalid-params", "missing 'url'");
    return json(
      await handleWebRead({ url, objective: str(params, "objective"), forceRefetch: bool(params, "forceRefetch") }),
    );
  },

  webSearch2: async ({ params, config, forward }) => {
    if (!config.exaApiKey) {
      logger.warn("webSearch2: no exaApiKey configured, forwarding upstream");
      return forward();
    }
    const objective = str(params, "objective");
    if (!objective) return error("invalid-params", "missing 'objective'");
    return handleSearch(
      { objective, searchQueries: strArray(params, "searchQueries"), maxResults: num(params, "maxResults") },
      config.exaApiKey,
    ).then(json, (err) => {
      logger.warn("webSearch2 local failed, falling back to upstream", { error: String(err) });
      return forward();
    });
  },
};

export function isLocalMethod(search: string): boolean {
  return search.replace("?", "") in handlers;
}

export async function handleInternal(req: Request, search: string, config: ProxyConfig): Promise<Response> {
  const method = search.replace("?", "");
  const body = req.method === "POST" ? await req.text() : "";

  let params: Record<string, unknown>;
  try {
    params = JSON.parse(body).params ?? {};
  } catch {
    return error("invalid-body", "Invalid JSON body");
  }

  logger.info(`[INTERNAL] ${method} params=${JSON.stringify(params).slice(0, 200)}`);

  const forward = () => {
    const rebuilt = new Request(req.url, { method: req.method, headers: req.headers, body: body || undefined });
    return upstream.forward(rebuilt, config.ampUpstreamUrl, config.ampApiKey);
  };

  const handler = handlers[method];
  return handler ? handler({ params, config, forward }) : forward();
}

function str(p: Record<string, unknown>, k: string): string | undefined {
  const v = p[k];
  return typeof v === "string" ? v : undefined;
}

function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k];
  return typeof v === "number" ? v : undefined;
}

function bool(p: Record<string, unknown>, k: string): boolean | undefined {
  const v = p[k];
  return typeof v === "boolean" ? v : undefined;
}

function strArray(p: Record<string, unknown>, k: string): string[] | undefined {
  const v = p[k];
  return Array.isArray(v) && v.every((i: unknown) => typeof i === "string") ? (v as string[]) : undefined;
}

function json(data: unknown): Response {
  return Response.json(data);
}

function error(code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } });
}
