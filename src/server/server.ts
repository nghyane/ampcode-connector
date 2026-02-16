/** HTTP server — routes provider requests through local OAuth or Amp upstream. */

import type { ProxyConfig } from "../config/config.ts";
import * as rewriter from "../proxy/rewriter.ts";
import * as upstream from "../proxy/upstream.ts";
import { parseRetryAfter, record429 } from "../routing/cooldown.ts";
import { recordSuccess, rerouteAfter429, routeRequest } from "../routing/router.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";

/** Max 429-reroute attempts before falling back to upstream. */
const MAX_REROUTE_ATTEMPTS = 4;

export function startServer(config: ProxyConfig): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: config.port,
    hostname: "localhost",

    async fetch(req) {
      const startTime = Date.now();
      try {
        const response = await handle(req, config);
        logRequest(req, startTime, response.status);
        return response;
      } catch (err) {
        logRequest(req, startTime, 500);
        logger.error("Unhandled server error", { error: String(err) });
        return new Response(JSON.stringify({ error: "Internal proxy error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });

  logger.info(`ampcode-connector listening on http://localhost:${config.port}`);
  return server;
}

async function handle(req: Request, config: ProxyConfig): Promise<Response> {
  const { pathname } = new URL(req.url);

  if ((pathname === "/" || pathname === "/status") && req.method === "GET") {
    return healthCheck(config);
  }

  if (path.browser(pathname)) {
    const target = new URL(pathname + new URL(req.url).search, config.ampUpstreamUrl);
    return Response.redirect(target.toString(), 302);
  }

  if (path.passthrough(pathname)) {
    return upstream.forward(req, config.ampUpstreamUrl, config.ampApiKey);
  }

  const providerName = path.provider(pathname);
  if (providerName) return handleProvider(req, providerName, pathname, config);

  return upstream.forward(req, config.ampUpstreamUrl, config.ampApiKey);
}

async function handleProvider(
  req: Request,
  providerName: string,
  pathname: string,
  config: ProxyConfig,
): Promise<Response> {
  const sub = path.subpath(pathname);
  const threadId = req.headers.get("x-amp-thread-id") ?? undefined;

  let body = "";
  if (req.method === "POST") body = await req.text();

  const model = path.model(body) ?? path.modelFromUrl(sub);
  let route = routeRequest(providerName, model, config, threadId);

  logger.info(`ROUTE ${route.decision} provider=${providerName} model=${model ?? "?"} account=${route.account} sub=${sub}`);

  if (route.handler) {
    const rewrite = model ? rewriter.rewrite(model) : undefined;
    const response = await route.handler.forward(sub, body, req.headers, rewrite, route.account);

    // 429 → attempt reroute to different account/pool
    if (response.status === 429 && route.pool) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      logger.warn(`429 from ${route.decision} account=${route.account}`, { retryAfter });

      for (let attempt = 0; attempt < MAX_REROUTE_ATTEMPTS; attempt++) {
        const next = rerouteAfter429(providerName, model, config, route.pool, route.account, retryAfter, threadId);
        if (!next) break;

        route = next;
        logger.info(`REROUTE → ${route.decision} account=${route.account}`);
        const retryResponse = await route.handler!.forward(sub, body, req.headers, rewrite, route.account);

        if (retryResponse.status === 429 && route.pool) {
          const nextRetryAfter = parseRetryAfter(retryResponse.headers.get("retry-after"));
          record429(route.pool, route.account, nextRetryAfter);
          continue;
        }

        if (retryResponse.status !== 401) {
          if (route.pool) recordSuccess(route.pool, route.account);
          return retryResponse;
        }
        break;
      }

      // All reroutes failed — fall through to upstream
    } else if (response.status === 401) {
      logger.debug("Local provider denied, falling back to upstream");
    } else {
      if (route.pool) recordSuccess(route.pool, route.account);
      return response;
    }
  }

  const upstreamReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: body || undefined,
  });
  return upstream.forward(upstreamReq, config.ampUpstreamUrl, config.ampApiKey);
}

function healthCheck(config: ProxyConfig): Response {
  return new Response(
    JSON.stringify(
      {
        status: "ok",
        service: "ampcode-connector",
        port: config.port,
        upstream: config.ampUpstreamUrl,
        providers: config.providers,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function logRequest(req: Request, startTime: number, statusCode: number): void {
  const duration = Date.now() - startTime;
  const { pathname } = new URL(req.url);
  logger.info(`${req.method} ${pathname}`, { duration });
}
