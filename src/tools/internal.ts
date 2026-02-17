/** Dispatcher for /api/internal?{method} — routes to local handlers or upstream. */

import type { ProxyConfig } from "../config/config.ts";
import * as upstream from "../proxy/upstream.ts";
import { logger } from "../utils/logger.ts";
import { handleExtract } from "./web-extract.ts";
import { handleSearch } from "./web-search.ts";

/** Methods handled locally instead of forwarding to Amp upstream. */
const LOCAL_METHODS = new Set(["extractWebPageContent", "webSearch2"]);

/** Check if an internal method should be handled locally. */
export function isLocalMethod(search: string): boolean {
  const method = search.replace("?", "");
  return LOCAL_METHODS.has(method);
}

/** Handle an internal RPC call locally. Returns null if method is unknown. */
export async function handleInternal(req: Request, search: string, config: ProxyConfig): Promise<Response> {
  const method = search.replace("?", "");
  const body = req.method === "POST" ? await req.text() : "";

  let params: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body);
    params = parsed.params ?? {};
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid-body", message: "Invalid JSON body" } });
  }

  logger.info(`[INTERNAL] ${method} params=${JSON.stringify(params).slice(0, 200)}`);

  switch (method) {
    case "extractWebPageContent": {
      const result = await handleExtract({
        url: params.url as string,
        objective: params.objective as string | undefined,
        forceRefetch: params.forceRefetch as boolean | undefined,
      });
      return jsonResponse(result);
    }
    case "webSearch2": {
      if (!config.exaApiKey) {
        logger.warn("webSearch2 called but no exaApiKey configured, forwarding upstream");
        return upstream.forward(rebuildRequest(req, body), config.ampUpstreamUrl, config.ampApiKey);
      }
      const result = await handleSearch(
        {
          objective: params.objective as string,
          searchQueries: params.searchQueries as string[] | undefined,
          maxResults: params.maxResults as number | undefined,
        },
        config.exaApiKey,
      );
      return jsonResponse(result);
    }
    default:
      return upstream.forward(req, config.ampUpstreamUrl, config.ampApiKey);
  }
}

/** Rebuild request with already-consumed body for upstream forwarding. */
function rebuildRequest(req: Request, body: string): Request {
  return new Request(req.url, { method: req.method, headers: req.headers, body: body || undefined });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
