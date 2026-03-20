/** Unified Google provider — merges Gemini CLI and Antigravity strategies
 *  with internal fallback. Tries preferred strategy first, then falls back. */

import { google as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT, CODE_ASSIST_ENDPOINT } from "../constants.ts";
import { buildUrl, maybeWrap, withUnwrap } from "../utils/code-assist.ts";
import { logger } from "../utils/logger.ts";
import * as path from "../utils/path.ts";
import { apiError } from "../utils/responses.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./forward.ts";

const GOOGLE_CLIENT_METADATA = JSON.stringify({
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
});

interface GoogleStrategy {
  name: string;
  headers: Readonly<Record<string, string>>;
  endpoints: readonly string[];
  modelMapper?: (model: string) => string;
  wrapOpts: {
    userAgent: "antigravity" | "pi-coding-agent";
    requestIdPrefix: "agent" | "pi";
    requestType?: "agent";
  };
}

const geminiStrategy: GoogleStrategy = {
  name: "gemini",
  headers: {
    "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": GOOGLE_CLIENT_METADATA,
  },
  endpoints: [CODE_ASSIST_ENDPOINT],
  wrapOpts: {
    userAgent: "pi-coding-agent",
    requestIdPrefix: "pi",
  },
};

const antigravityStrategy: GoogleStrategy = {
  name: "antigravity",
  headers: {
    "User-Agent": "antigravity/1.15.8 darwin/arm64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": GOOGLE_CLIENT_METADATA,
  },
  endpoints: [ANTIGRAVITY_DAILY_ENDPOINT, AUTOPUSH_ENDPOINT, CODE_ASSIST_ENDPOINT],
  modelMapper: (model: string) => (model === "gemini-3-flash-preview" ? "gemini-3-flash" : model),
  wrapOpts: {
    userAgent: "antigravity",
    requestIdPrefix: "agent",
    requestType: "agent",
  },
};

const strategies: readonly GoogleStrategy[] = [geminiStrategy, antigravityStrategy];

const COOLDOWN_MS = 60_000;

interface StrategyPreference {
  strategy: GoogleStrategy;
  until: number;
}

// Per-account strategy preference: after success, prefer that strategy;
// after failure, skip it for COOLDOWN_MS.
const preferredStrategy = new Map<number, StrategyPreference>();
const cooldowns = new Map<string, number>(); // key: `${account}:${strategy.name}`

function cooldownKey(account: number, strategy: GoogleStrategy): string {
  return `${account}:${strategy.name}`;
}

function getOrderedStrategies(account: number): GoogleStrategy[] {
  const now = Date.now();
  const pref = preferredStrategy.get(account);
  const ordered =
    pref && pref.until > now ? [pref.strategy, ...strategies.filter((s) => s !== pref.strategy)] : [...strategies];

  return ordered.filter((s) => {
    const cd = cooldowns.get(cooldownKey(account, s));
    return !cd || cd <= now;
  });
}

function markSuccess(account: number, strategy: GoogleStrategy): void {
  preferredStrategy.set(account, { strategy, until: Date.now() + COOLDOWN_MS * 10 });
  cooldowns.delete(cooldownKey(account, strategy));
}

function markFailure(account: number, strategy: GoogleStrategy): void {
  cooldowns.set(cooldownKey(account, strategy), Date.now() + COOLDOWN_MS);
  const pref = preferredStrategy.get(account);
  if (pref?.strategy === strategy) {
    preferredStrategy.delete(account);
  }
}

export const provider: Provider = {
  name: "Google",
  routeDecision: "LOCAL_GOOGLE",

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("google", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, _originalHeaders, rewrite, account = 0) {
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("Google");

    const creds = store.get("google", account);
    const projectId = creds?.projectId ?? "";
    const email = creds?.email;

    const modelAction = path.googleModel(sub);
    if (!modelAction) {
      logger.debug(`Non-model Google path, cannot route to CCA: ${sub}`);
      return denied("Google (unsupported path)");
    }

    const unwrapThenRewrite = withUnwrap(rewrite);
    const orderedStrategies = getOrderedStrategies(account);

    if (orderedStrategies.length === 0) {
      const now = Date.now();
      let minWait = COOLDOWN_MS;
      for (const s of strategies) {
        const until = cooldowns.get(cooldownKey(account, s));
        if (until) minWait = Math.min(minWait, Math.max(0, until - now));
      }
      const retryAfterS = Math.ceil(minWait / 1000);
      return new Response(
        JSON.stringify({
          error: { message: "All Google strategies cooling down", type: "rate_limit_error", code: "429" },
        }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterS) } },
      );
    }

    let saw429 = false;
    let lastResponse: Response | null = null;

    for (const strategy of orderedStrategies) {
      const model = strategy.modelMapper ? strategy.modelMapper(modelAction.model) : modelAction.model;
      const requestBody = maybeWrap(body.parsed, body.forwardBody, projectId, model, strategy.wrapOpts);

      const headers: Record<string, string> = {
        ...strategy.headers,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: body.stream ? "text/event-stream" : "application/json",
      };

      logger.info(`Google strategy=${strategy.name} account=${account}`);

      for (const endpoint of strategy.endpoints) {
        const url = buildUrl(endpoint, modelAction.action);
        try {
          const response = await forward({
            url,
            body: requestBody,
            streaming: body.stream,
            headers,
            providerName: `Google/${strategy.name}`,
            rewrite: unwrapThenRewrite,
            email,
          });

          if (response.status === 401 || response.status === 403) {
            return response;
          }

          if (response.status === 429) {
            saw429 = true;
            lastResponse = response;
            logger.debug(`Google strategy=${strategy.name} failed (${response.status}), trying next`);
            break;
          }

          if (response.status >= 500) {
            lastResponse = response;
            logger.debug(`Google strategy=${strategy.name} failed (${response.status}), trying next`);
            continue;
          }

          markSuccess(account, strategy);
          return response;
        } catch (err) {
          lastResponse = apiError(502, `Google/${strategy.name} endpoint failed: ${String(err)}`);
          logger.debug(`Google strategy=${strategy.name} endpoint error`, { error: String(err) });
        }
      }

      markFailure(account, strategy);
    }

    if (saw429) {
      return lastResponse ?? apiError(429, "All Google strategies rate limited", "rate_limit_error");
    }

    return lastResponse ?? apiError(502, "All Google strategies exhausted");
  },
};
