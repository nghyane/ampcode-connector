/** Forwards requests to chatgpt.com/backend-api/codex with Codex CLI OAuth token.
 *
 *  The ChatGPT backend requires specific headers (account-id from JWT, originator,
 *  OpenAI-Beta) and a different URL path (/codex/responses) than api.openai.com. */

import { codex as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { CODEX_BASE_URL, codexHeaders, codexHeaderValues, codexPathMap } from "../constants.ts";
import { fromBase64url } from "../utils/encoding.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./base.ts";

export const provider: Provider = {
  name: "OpenAI Codex",
  routeDecision: "LOCAL_CODEX",

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("codex", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, _originalHeaders, rewrite, account = 0) {
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("OpenAI Codex");

    const accountId = getAccountId(accessToken, account);
    const codexPath = codexPathMap[sub] ?? sub;

    return forward({
      url: `${CODEX_BASE_URL}${codexPath}`,
      body: body.forwardBody,
      streaming: body.stream,
      providerName: "OpenAI Codex",
      rewrite,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Accept: body.stream ? "text/event-stream" : "application/json",
        Connection: "Keep-Alive",
        [codexHeaders.BETA]: codexHeaderValues.BETA_RESPONSES,
        [codexHeaders.ORIGINATOR]: codexHeaderValues.ORIGINATOR,
        "User-Agent": codexHeaderValues.USER_AGENT,
        Version: codexHeaderValues.VERSION,
        ...(accountId ? { [codexHeaders.ACCOUNT_ID]: accountId } : {}),
      },
    });
  },
};

/** Extract chatgpt_account_id from JWT, falling back to stored credentials. */
function getAccountId(accessToken: string, account: number): string | undefined {
  const creds = store.get("codex", account);
  if (creds?.accountId) return creds.accountId;

  try {
    const parts = accessToken.split(".");
    if (parts.length < 2 || !parts[1]) return undefined;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    return (auth?.chatgpt_account_id as string) ?? undefined;
  } catch {
    return undefined;
  }
}
