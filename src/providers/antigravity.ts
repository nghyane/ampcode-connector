/** Forwards requests to Cloud Code Assist API using Antigravity quota.
 *  Uses the shared Google OAuth token with Antigravity headers/endpoints.
 *  Tries multiple endpoints with fallback on 5xx. */

import { google as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT, CODE_ASSIST_ENDPOINT } from "../constants.ts";
import * as codeAssist from "../utils/code-assist.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./base.ts";

const endpoints = [ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT, CODE_ASSIST_ENDPOINT];

const antigravityHeaders: Readonly<Record<string, string>> = {
  "User-Agent": "antigravity/1.15.8 darwin/arm64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }),
};

export const provider: Provider = {
  name: "Antigravity",
  routeDecision: "LOCAL_ANTIGRAVITY",

  isAvailable: () => oauth.ready(config),

  async forward(sub, body, originalHeaders, rewrite) {
    const accessToken = await oauth.token(config);
    if (!accessToken) return denied("Antigravity");

    const creds = store.get("google");
    const projectId = creds?.projectId ?? "";

    const headers: Record<string, string> = {
      ...antigravityHeaders,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const anthropicBeta = originalHeaders.get("anthropic-beta");
    if (anthropicBeta) headers["anthropic-beta"] = anthropicBeta;

    const gemini = path.gemini(sub);
    const action = gemini?.action ?? "generateContent";
    const model = gemini?.model ?? "";
    const requestBody = maybeWrap(body, projectId, model);
    const unwrapThenRewrite = withUnwrap(rewrite);

    return tryEndpoints(requestBody, headers, action, unwrapThenRewrite);
  },
};

function withUnwrap(rewrite?: (d: string) => string): (d: string) => string {
  return rewrite ? (d: string) => rewrite(codeAssist.unwrap(d)) : codeAssist.unwrap;
}

function maybeWrap(body: string, projectId: string, model: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed["project"]) return body;
    return codeAssist.wrapRequest({
      projectId,
      model,
      body: parsed,
      userAgent: "antigravity",
      requestIdPrefix: "agent",
      requestType: "agent",
    });
  } catch (err) {
    logger.debug("Body parse failed, forwarding as-is", { error: String(err) });
    return body;
  }
}

async function tryEndpoints(
  body: string,
  headers: Record<string, string>,
  action: string,
  rewrite?: (data: string) => string,
): Promise<Response> {
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    const url = codeAssist.buildUrl(endpoint, action);
    try {
      const response = await forward({ url, body, headers, providerName: "Antigravity", rewrite });
      if (response.status < 500) return response;
      lastError = new Error(`${endpoint} returned ${response.status}`);
      logger.debug("Endpoint 5xx, trying next", { provider: "Antigravity" });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.debug("Endpoint failed, trying next", { error: String(err) });
    }
  }

  return new Response(JSON.stringify({ error: `All Antigravity endpoints failed: ${lastError?.message}` }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}
