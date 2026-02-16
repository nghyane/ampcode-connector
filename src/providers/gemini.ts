/** Forwards requests to Cloud Code Assist API using Gemini CLI quota.
 *  Amp CLI uses @google/genai SDK with vertexai:true — sends Vertex AI format
 *  (e.g. /v1beta1/publishers/google/models/{model}:streamGenerateContent?alt=sse).
 *  We wrap the native body in a CCA envelope, forward to cloudcode-pa, and unwrap
 *  the response so Amp CLI sees standard Vertex AI SSE chunks. */

import { google as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { CODE_ASSIST_ENDPOINT } from "../constants.ts";
import * as codeAssist from "../utils/code-assist.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./base.ts";

const geminiHeaders: Readonly<Record<string, string>> = {
  "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }),
};

export const provider: Provider = {
  name: "Gemini CLI",
  routeDecision: "LOCAL_GEMINI",

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("google", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, _originalHeaders, rewrite, account = 0) {
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("Gemini CLI");

    const creds = store.get("google", account);
    const projectId = creds?.projectId ?? "";

    const headers: Record<string, string> = {
      ...geminiHeaders,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const gemini = path.gemini(sub);
    if (!gemini) {
      logger.debug(`Non-model Gemini path, cannot route to CCA: ${sub}`);
      return denied("Gemini CLI (unsupported path)");
    }

    const url = codeAssist.buildUrl(CODE_ASSIST_ENDPOINT, gemini.action);
    const requestBody = maybeWrap(body, projectId, gemini.model);
    const unwrapThenRewrite = withUnwrap(rewrite);

    return forward({ url, body: requestBody, headers, providerName: "Gemini CLI", rewrite: unwrapThenRewrite });
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
      userAgent: "pi-coding-agent",
      requestIdPrefix: "pi",
    });
  } catch (err) {
    logger.debug("Body parse failed, forwarding as-is", { error: String(err) });
    return body;
  }
}
