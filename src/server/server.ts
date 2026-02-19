/** HTTP server — routes provider requests through local OAuth or Amp upstream. */

import type { ProxyConfig } from "../config/config.ts";
import * as rewriter from "../proxy/rewriter.ts";
import * as upstream from "../proxy/upstream.ts";
import { startCleanup } from "../routing/affinity.ts";
import { tryReroute, tryWithCachePreserve } from "../routing/retry.ts";
import { recordSuccess, routeRequest } from "../routing/router.ts";
import { handleInternal, isLocalMethod } from "../tools/internal.ts";
import { maybeShowAd } from "../utils/ads.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import { record, snapshot } from "../utils/stats.ts";
import { type ParsedBody, parseBody } from "./body.ts";

export function startServer(config: ProxyConfig): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: config.port,
    hostname: "localhost",

    async fetch(req) {
      const startTime = Date.now();
      const url = new URL(req.url);
      let status = 500;
      try {
        const response = await handle(req, url, config);
        status = response.status;
        return response;
      } catch (err) {
        logger.error("Unhandled server error", { error: String(err) });
        return Response.json({ error: "Internal proxy error" }, { status });
      } finally {
        logger.info(`${req.method} ${url.pathname} ${status}`, { duration: Date.now() - startTime });
      }
    },
  });

  startCleanup();
  logger.info(`ampcode-connector listening on http://localhost:${config.port}`);

  const shutdown = () => {
    logger.info("Shutting down...");
    server.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}

async function handle(req: Request, url: URL, config: ProxyConfig): Promise<Response> {
  const { pathname, search } = url;

  if ((pathname === "/" || pathname === "/status") && req.method === "GET") {
    return healthCheck(config);
  }

  if (path.browser(pathname)) {
    const target = new URL(pathname + search, config.ampUpstreamUrl);
    return Response.redirect(target.toString(), 302);
  }

  if (path.passthrough(pathname)) {
    if (pathname.startsWith("/api/internal") && isLocalMethod(search)) {
      return handleInternal(req, search, config);
    }
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
  const startTime = Date.now();
  const sub = path.subpath(pathname);
  const threadId = req.headers.get("x-amp-thread-id") ?? undefined;

  const rawBody = req.method === "POST" ? await req.text() : "";
  const body = parseBody(rawBody, sub);
  const ampModel = body.ampModel;
  const route = routeRequest(providerName, ampModel, config, threadId);

  logger.info(
    `ROUTE ${route.decision} provider=${providerName} model=${ampModel ?? "?"} account=${route.account} sub=${sub}`,
  );

  let response: Response;

  if (route.handler) {
    const rewrite = ampModel ? rewriter.rewrite(ampModel) : undefined;
    const handlerResponse = await route.handler.forward(sub, body, req.headers, rewrite, route.account);

    if (handlerResponse.status === 429 && route.pool) {
      const cached = await tryWithCachePreserve(route, sub, body, req.headers, rewrite, handlerResponse);
      if (cached) {
        response = cached;
      } else {
        const rerouted = await tryReroute(
          providerName,
          ampModel,
          config,
          route,
          sub,
          body,
          req.headers,
          rewrite,
          handlerResponse,
          threadId,
        );
        response = rerouted ?? (await fallbackUpstream(req, body, config));
      }
    } else if (handlerResponse.status === 401) {
      logger.debug("Local provider denied, falling back to upstream");
      response = await fallbackUpstream(req, body, config);
    } else {
      if (route.pool) recordSuccess(route.pool, route.account);
      response = handlerResponse;
    }
  } else {
    response = await fallbackUpstream(req, body, config);
  }

  record({
    timestamp: new Date().toISOString(),
    route: route.decision,
    provider: providerName,
    model: ampModel ?? "unknown",
    statusCode: response.status,
    durationMs: Date.now() - startTime,
  });

  maybeShowAd();

  return response;
}

/** Fall back to Amp upstream when local providers fail. */
function fallbackUpstream(req: Request, body: ParsedBody, config: ProxyConfig): Promise<Response> {
  const upstreamReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: body.raw || undefined,
  });
  return upstream.forward(upstreamReq, config.ampUpstreamUrl, config.ampApiKey);
}

function healthCheck(config: ProxyConfig): Response {
  return Response.json({
    status: "ok",
    service: "ampcode-connector",
    port: config.port,
    upstream: config.ampUpstreamUrl,
    providers: config.providers,
    stats: snapshot(),
  });
}
