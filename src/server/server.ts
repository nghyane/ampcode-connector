/** HTTP server — routes provider requests through local OAuth or Amp upstream. */

import type { ProxyConfig } from "../config/config.ts";
import * as rewriter from "../proxy/rewriter.ts";
import * as upstream from "../proxy/upstream.ts";
import { startCleanup } from "../routing/affinity.ts";
import { parseRetryAfter, record429 } from "../routing/cooldown.ts";
import { type RouteResult, recordSuccess, rerouteAfter429, routeRequest } from "../routing/router.ts";
import { handleInternal, isLocalMethod } from "../tools/internal.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import { type ParsedBody, parseBody } from "./body.ts";

/** Max 429-reroute attempts before falling back to upstream. */
const MAX_REROUTE_ATTEMPTS = 4;
/** Max seconds to wait-and-retry on the same account (preserves prompt cache). */
const CACHE_PRESERVE_WAIT_MAX_S = 10;

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
        return new Response(JSON.stringify({ error: "Internal proxy error" }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
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
  const sub = path.subpath(pathname);
  const threadId = req.headers.get("x-amp-thread-id") ?? undefined;

  const rawBody = req.method === "POST" ? await req.text() : "";
  const body = parseBody(rawBody, sub);
  const ampModel = body.ampModel;
  const route = routeRequest(providerName, ampModel, config, threadId);

  logger.info(
    `ROUTE ${route.decision} provider=${providerName} model=${ampModel ?? "?"} account=${route.account} sub=${sub}`,
  );

  if (route.handler) {
    const rewrite = ampModel ? rewriter.rewrite(ampModel) : undefined;
    const response = await route.handler.forward(sub, body, req.headers, rewrite, route.account);

    if (response.status === 429 && route.pool) {
      const cached = await tryWithCachePreserve(route, sub, body, req.headers, rewrite, response);
      if (cached) return cached;

      const rerouted = await tryReroute(
        providerName,
        ampModel,
        config,
        route,
        sub,
        body,
        req.headers,
        rewrite,
        response,
        threadId,
      );
      if (rerouted) return rerouted;
    } else if (response.status === 401) {
      logger.debug("Local provider denied, falling back to upstream");
    } else {
      if (route.pool) recordSuccess(route.pool, route.account);
      return response;
    }
  }

  return fallbackUpstream(req, body, config);
}

/** Wait briefly and retry on the same account to preserve prompt cache. */
async function tryWithCachePreserve(
  route: RouteResult,
  sub: string,
  body: ParsedBody,
  headers: Headers,
  rewrite: ((data: string) => string) | undefined,
  initialResponse: Response,
): Promise<Response | null> {
  const retryAfter = parseRetryAfter(initialResponse.headers.get("retry-after"));
  if (retryAfter === undefined || retryAfter > CACHE_PRESERVE_WAIT_MAX_S) return null;

  logger.debug(`Waiting ${retryAfter}s to preserve prompt cache on account=${route.account}`);
  await Bun.sleep(retryAfter * 1000);
  const response = await route.handler!.forward(sub, body, headers, rewrite, route.account);

  if (response.status !== 429 && response.status !== 401) {
    recordSuccess(route.pool!, route.account);
    return response;
  }
  if (response.status === 429) {
    const nextRetryAfter = parseRetryAfter(response.headers.get("retry-after"));
    record429(route.pool!, route.account, nextRetryAfter);
  }
  return null;
}

/** Reroute to different accounts/pools after 429 (cache loss accepted). */
async function tryReroute(
  providerName: string,
  ampModel: string | null,
  config: ProxyConfig,
  initialRoute: RouteResult,
  sub: string,
  body: ParsedBody,
  headers: Headers,
  rewrite: ((data: string) => string) | undefined,
  initialResponse: Response,
  threadId?: string,
): Promise<Response | null> {
  const retryAfter = parseRetryAfter(initialResponse.headers.get("retry-after"));
  logger.warn(`429 from ${initialRoute.decision} account=${initialRoute.account}`, { retryAfter });

  let currentPool = initialRoute.pool!;
  let currentAccount = initialRoute.account;

  for (let attempt = 0; attempt < MAX_REROUTE_ATTEMPTS; attempt++) {
    const next = rerouteAfter429(providerName, ampModel, config, currentPool, currentAccount, retryAfter, threadId);
    if (!next) break;

    logger.info(`REROUTE -> ${next.decision} account=${next.account}`);
    const response = await next.handler!.forward(sub, body, headers, rewrite, next.account);

    if (response.status === 429 && next.pool) {
      const nextRetryAfter = parseRetryAfter(response.headers.get("retry-after"));
      record429(next.pool, next.account, nextRetryAfter);
      currentPool = next.pool;
      currentAccount = next.account;
      continue;
    }

    if (response.status !== 401) {
      if (next.pool) recordSuccess(next.pool, next.account);
      return response;
    }
    break;
  }

  return null;
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
