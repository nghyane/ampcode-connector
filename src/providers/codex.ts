/** Forwards requests to api.openai.com with Codex CLI OAuth token. */

import { codex as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { OPENAI_API_URL } from "../constants.ts";
import * as path from "../utils/path.ts";
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

    return forward({
      url: `${OPENAI_API_URL}${sub}`,
      body,
      providerName: "OpenAI Codex",
      rewrite,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        Accept: path.streaming(body) ? "text/event-stream" : "application/json",
      },
    });
  },
};
