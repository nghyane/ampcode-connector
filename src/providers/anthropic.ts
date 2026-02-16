/** Forwards requests to api.anthropic.com with Claude Code stealth headers. */

import { anthropic as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import {
  ANTHROPIC_API_URL,
  CLAUDE_CODE_VERSION,
  claudeCodeBetas,
  filteredBetaFeatures,
  stainlessHeaders,
} from "../constants.ts";
import * as path from "../utils/path.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./base.ts";

export const provider: Provider = {
  name: "Anthropic",
  routeDecision: "LOCAL_CLAUDE",

  isAvailable: () => oauth.ready(config),

  async forward(sub, body, originalHeaders, rewrite) {
    const accessToken = await oauth.token(config);
    if (!accessToken) return denied("Anthropic");

    return forward({
      url: `${ANTHROPIC_API_URL}${sub}`,
      body,
      providerName: "Anthropic",
      rewrite,
      headers: {
        ...stainlessHeaders,
        Accept: path.streaming(body) ? "text/event-stream" : "application/json",
        "Accept-Encoding": "br, gzip, deflate",
        Connection: "keep-alive",
        "Content-Type": "application/json",
        "Anthropic-Version": "2023-06-01",
        "Anthropic-Dangerous-Direct-Browser-Access": "true",
        "Anthropic-Beta": betaHeader(originalHeaders.get("anthropic-beta")),
        "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
        "X-App": "cli",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  },
};

function betaHeader(original: string | null): string {
  const features = new Set<string>(claudeCodeBetas);

  if (original) {
    for (const raw of original.split(",")) {
      const feature = raw.trim();
      if (feature && !filteredBetaFeatures.includes(feature as (typeof filteredBetaFeatures)[number])) {
        features.add(feature);
      }
    }
  }

  return Array.from(features).join(",");
}
