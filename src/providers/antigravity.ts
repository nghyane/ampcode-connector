/** Forwards requests to Cloud Code Assist API using Antigravity quota.
 *  Uses the shared Google OAuth token with Antigravity headers/endpoints.
 *  Tries multiple endpoints with fallback on 5xx. */

import { google as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT, CODE_ASSIST_ENDPOINT } from "../constants.ts";
import { buildUrl, maybeWrap, withUnwrap } from "../utils/code-assist.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./forward.ts";

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

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("google", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, _originalHeaders, rewrite, account = 0) {
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("Antigravity");

    const creds = store.get("google", account);
    const projectId = creds?.projectId ?? "";

    const headers: Record<string, string> = {
      ...antigravityHeaders,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: body.stream ? "text/event-stream" : "application/json",
    };
    const gemini = path.gemini(sub);
    const action = gemini?.action ?? "generateContent";
    const model = gemini?.model === "gemini-3-flash-preview" ? "gemini-3-flash" : (gemini?.model ?? "");
    const requestBody = maybeWrap(body.parsed, body.forwardBody, projectId, model, {
      userAgent: "antigravity",
      requestIdPrefix: "agent",
      requestType: "agent",
    });
    const unwrapThenRewrite = withUnwrap(rewrite);

    return tryEndpoints(requestBody, body.stream, headers, action, unwrapThenRewrite, creds?.email);
  },
};

async function tryEndpoints(
  body: string,
  streaming: boolean,
  headers: Record<string, string>,
  action: string,
  rewrite?: (data: string) => string,
  email?: string,
): Promise<Response> {
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    const url = buildUrl(endpoint, action);
    try {
      const response = await forward({ url, body, streaming, headers, providerName: "Antigravity", rewrite, email });
      if (response.status < 500) return response;
      lastError = new Error(`${endpoint} returned ${response.status}`);
      logger.debug("Endpoint 5xx, trying next", { provider: "Antigravity" });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.debug("Endpoint failed, trying next", { error: String(err) });
    }
  }

  return Response.json({ error: `All Antigravity endpoints failed: ${lastError?.message}` }, { status: 502 });
}
