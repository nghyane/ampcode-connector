/** Reverse proxy to ampcode.com for non-intercepted routes and fallback. */

import { logger } from "../utils/logger.ts";

export async function forward(request: Request, ampUpstreamUrl: string, ampApiKey?: string): Promise<Response> {
  const url = new URL(request.url);
  const upstreamUrl = new URL(url.pathname + url.search, ampUpstreamUrl);

  const upstreamHost = new URL(ampUpstreamUrl).host;
  const headers = new Headers(request.headers);
  if (ampApiKey) headers.set("Authorization", `Bearer ${ampApiKey}`);
  headers.set("Host", upstreamHost);

  logger.debug("Forwarding to Amp upstream", { provider: "amp" });

  try {
    const response = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers,
      redirect: "manual",
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      duplex: "half" as const,
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("Content-Encoding");
    responseHeaders.delete("Content-Length");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    logger.error("Upstream proxy error", { error: String(err) });
    return Response.json({ error: "Failed to connect to Amp upstream", details: String(err) }, { status: 502 });
  }
}
