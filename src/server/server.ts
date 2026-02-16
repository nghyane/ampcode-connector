/** HTTP server — routes provider requests through local OAuth or Amp upstream. */

import type { ProxyConfig } from "../config/config.ts";
import * as rewriter from "../proxy/rewriter.ts";
import * as upstream from "../proxy/upstream.ts";
import { routeRequest } from "../routing/router.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";

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

  let body = "";
  if (req.method === "POST") body = await req.text();

  const model = path.model(body) ?? path.modelFromUrl(sub);
  const route = routeRequest(providerName, model, config);

  logger.info(`ROUTE ${route.decision} provider=${providerName} model=${model ?? "?"} sub=${sub}`);

  if (route.handler) {
    const rewrite = model ? rewriter.rewrite(model) : undefined;
    return route.handler.forward(sub, body, req.headers, rewrite);
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
