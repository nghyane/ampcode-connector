/** Unified Google provider — merges Gemini CLI and Antigravity strategies
 *  with internal fallback. Tries preferred strategy first, then falls back. */

import { google as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_DAILY_SANDBOX_ENDPOINT, CODE_ASSIST_ENDPOINT } from "../constants.ts";
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
    requestType?: "agent" | "image_gen";
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

/** Antigravity uses different model names than what Amp CLI sends. */
const antigravityModelMap: Record<string, string> = {
  "gemini-3-flash-preview": "gemini-3-flash",
  "gemini-3-pro-preview": "gemini-3-pro-high",
  "gemini-3-pro-image-preview": "gemini-3.1-flash-image",
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
};

const antigravityStrategy: GoogleStrategy = {
  name: "antigravity",
  headers: {
    "User-Agent": "antigravity/1.104.0 darwin/arm64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": GOOGLE_CLIENT_METADATA,
  },
  endpoints: [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_DAILY_SANDBOX_ENDPOINT, CODE_ASSIST_ENDPOINT],
  modelMapper: (model: string) => antigravityModelMap[model] ?? model,
  wrapOpts: {
    userAgent: "antigravity",
    requestIdPrefix: "agent",
    requestType: "agent",
  },
};

const strategies: readonly GoogleStrategy[] = [geminiStrategy, antigravityStrategy];

/** Models that only work on the antigravity strategy. */
const ANTIGRAVITY_ONLY_MODELS = new Set(["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]);

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

function getOrderedStrategies(account: number, model?: string): GoogleStrategy[] {
  const now = Date.now();

  // Some models only work on antigravity — skip other strategies entirely
  if (model && ANTIGRAVITY_ONLY_MODELS.has(model)) {
    const cd = cooldowns.get(cooldownKey(account, antigravityStrategy));
    if (cd && cd > now) return [];
    return [antigravityStrategy];
  }

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

/** Buffer an SSE response and merge all chunks into a single JSON response.
 *  Used when we force streamGenerateContent but the client expects non-streaming JSON.
 *  Accumulates all candidate parts across chunks (image inlineData may be in earlier chunks). */
async function bufferSSEToJSON(response: Response): Promise<Response | null> {
  const text = await response.text();
  const chunks: Record<string, unknown>[] = [];

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(data) as Record<string, unknown>);
    } catch {
      // skip non-JSON
    }
  }

  if (chunks.length === 0) return null;
  if (chunks.length === 1) {
    return new Response(JSON.stringify(chunks[0]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Merge: accumulate parts from all chunks into the first candidate
  const merged = chunks[0]! as Record<string, unknown>;
  const allParts: unknown[] = [];

  for (const chunk of chunks) {
    const candidates = chunk.candidates as { content?: { parts?: unknown[] } }[] | undefined;
    if (!candidates) continue;
    for (const candidate of candidates) {
      if (candidate.content?.parts) {
        allParts.push(...candidate.content.parts);
      }
    }
  }

  // Use last chunk's metadata (finishReason, usageMetadata)
  const last = chunks[chunks.length - 1]! as Record<string, unknown>;
  const lastCandidates = last.candidates as Record<string, unknown>[] | undefined;
  const mergedCandidates = merged.candidates as Record<string, unknown>[] | undefined;

  if (mergedCandidates?.[0] && allParts.length > 0) {
    const content = (mergedCandidates[0] as Record<string, unknown>).content as Record<string, unknown> | undefined;
    if (content) content.parts = allParts;
    if (lastCandidates?.[0]) {
      (mergedCandidates[0] as Record<string, unknown>).finishReason = (
        lastCandidates[0] as Record<string, unknown>
      ).finishReason;
    }
  }
  if (last.usageMetadata) merged.usageMetadata = last.usageMetadata;

  return new Response(JSON.stringify(merged), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Generate a fallback project ID when none is stored (matches CLIProxyAPI behavior). */
function generateProjectId(): string {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]!;
  const noun = nouns[Math.floor(Math.random() * nouns.length)]!;
  const rand = crypto.randomUUID().slice(0, 5).toLowerCase();
  return `${adj}-${noun}-${rand}`;
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
    const projectId = creds?.projectId || generateProjectId();
    const email = creds?.email;

    const modelAction = path.googleModel(sub);
    if (!modelAction) {
      logger.debug(`Non-model Google path, cannot route to CCA: ${sub}`);
      return denied("Google (unsupported path)");
    }

    const unwrapThenRewrite = withUnwrap(rewrite);
    const orderedStrategies = getOrderedStrategies(account, modelAction.model);

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
      const isImageModel = model.includes("image");
      const wrapOpts = isImageModel ? { ...strategy.wrapOpts, requestType: "image_gen" as const } : strategy.wrapOpts;
      const requestBody = maybeWrap(body.parsed, body.forwardBody, projectId, model, wrapOpts);

      const headers: Record<string, string> = {
        ...strategy.headers,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: body.stream ? "text/event-stream" : "application/json",
      };

      logger.info(`Google strategy=${strategy.name} account=${account} model=${model}`);

      // Antigravity forces streaming endpoint for gemini-3-pro* and image models (matches CLIProxyAPI behavior)
      const forceStream = strategy.name === "antigravity" && (model.startsWith("gemini-3-pro") || isImageModel);
      const action = forceStream ? "streamGenerateContent" : modelAction.action;

      for (const endpoint of strategy.endpoints) {
        const url = buildUrl(endpoint, action);
        try {
          const forceStreamNonStreaming = forceStream && !body.stream;
          const response = await forward({
            url,
            body: requestBody,
            streaming: forceStreamNonStreaming ? true : body.stream,
            headers,
            providerName: `Google/${strategy.name}`,
            rewrite: unwrapThenRewrite,
            email,
          });

          // When we forced streaming but client expects JSON, buffer SSE and return last chunk
          if (forceStreamNonStreaming && response.ok && response.body) {
            const merged = await bufferSSEToJSON(response);
            if (merged) {
              markSuccess(account, strategy);
              return merged;
            }
          }

          if (response.status === 401 || response.status === 403) {
            return response;
          }

          if (response.status === 404) {
            lastResponse = response;
            logger.debug(`Google strategy=${strategy.name} model not found (404), trying next endpoint`);
            continue;
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
