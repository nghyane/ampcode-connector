/** Forwards requests to api.openai.com with Codex CLI OAuth token. */

import { codex as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import { OPENAI_API_URL } from "../constants.ts";
import * as path from "../utils/path.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./base.ts";

export const provider: Provider = {
  name: "OpenAI Codex",
  routeDecision: "LOCAL_CODEX",

  isAvailable: () => oauth.ready(config),

  async forward(sub, body, _originalHeaders, rewrite) {
    const accessToken = await oauth.token(config);
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
