/** Forwards requests to api.anthropic.com with Claude Code stealth headers. */

import { createHash } from "node:crypto";
import { anthropic as config } from "../auth/configs.ts";
import * as oauth from "../auth/oauth.ts";
import * as store from "../auth/store.ts";
import { ANTHROPIC_API_URL, CLAUDE_CODE_VERSION, claudeCodeBetas, filteredBetaFeatures } from "../constants.ts";
import type { ParsedBody } from "../server/body.ts";
import type { Provider } from "./base.ts";
import { denied, forward } from "./forward.ts";

/** Headers to drop from client request (replaced by connector or irrelevant). */
const DROP_HEADERS = new Set(["host", "content-length", "connection", "x-api-key", "authorization", "anthropic-beta"]);

/** Extract X-Stainless-* and other passthrough headers from the client request. */
function passthroughHeaders(originalHeaders: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of originalHeaders.entries()) {
    if (DROP_HEADERS.has(k)) continue;
    // Drop amp-specific headers
    if (k.startsWith("x-amp-")) continue;
    out[k] = v;
  }
  return out;
}

export const provider: Provider = {
  name: "Anthropic",
  routeDecision: "LOCAL_CLAUDE",

  isAvailable: (account?: number) =>
    account !== undefined ? !!store.get("anthropic", account)?.refreshToken : oauth.ready(config),

  accountCount: () => oauth.accountCount(config),

  async forward(sub, body, originalHeaders, rewrite, account = 0) {
    const accessToken = await oauth.token(config, account);
    if (!accessToken) return denied("Anthropic");

    const fwdBody = prepareBody(body);
    const betaHdr = betaHeader(originalHeaders.get("anthropic-beta"));
    const clientHeaders = passthroughHeaders(originalHeaders);

    return forward({
      url: `${ANTHROPIC_API_URL}${sub}`,
      body: fwdBody,
      streaming: body.stream,
      providerName: "Anthropic",
      rewrite,
      email: store.get("anthropic", account)?.email,
      headers: {
        // Client headers first (stainless, accept, content-type, anthropic-version, etc.)
        ...clientHeaders,
        // Override auth + identity
        "Anthropic-Dangerous-Direct-Browser-Access": "true",
        "Anthropic-Beta": betaHdr,
        "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
        "X-App": "cli",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  },
};

const BILLING_SALT = "59cf53e54c78";

/** Compute the cch checksum from the first user message text and version. */
function computeCch(firstUserText: string, version: string): string {
  const chars = [4, 7, 20].map((i) => firstUserText[i] || "0").join("");
  return createHash("sha256").update(`${BILLING_SALT}${chars}${version}`).digest("hex").slice(0, 5);
}

/** Extract text from the first user message in the body. */
function firstUserText(parsed: Record<string, unknown>): string {
  const messages = parsed.messages as Array<{ role?: string; content?: unknown }> | undefined;
  if (!Array.isArray(messages)) return "";
  const userMsg = messages.find((m) => m.role === "user");
  if (!userMsg) return "";
  if (typeof userMsg.content === "string") return userMsg.content;
  if (Array.isArray(userMsg.content)) {
    const textBlock = userMsg.content.find((b: { type?: string }) => b.type === "text") as
      | { text?: string }
      | undefined;
    return textBlock?.text ?? "";
  }
  return "";
}

/** Prepare body: inject billing header + strip speed field.
 *  Always re-injects billing header because cch depends on per-request message content.
 *  Shallow-copies parsed to avoid mutating the shared ParsedBody.parsed reference. */
export function prepareBody(body: ParsedBody): string {
  const raw = body.forwardBody;

  try {
    const original = body.parsed;
    if (!original) return raw;

    const text = firstUserText(original);
    const cch = computeCch(text, CLAUDE_CODE_VERSION);
    const billingLine = `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}; cc_entrypoint=cli; cch=${cch};`;

    const { speed: _, system: existingSystem, ...rest } = original;
    const prepared = {
      ...rest,
      system: injectBillingHeader(existingSystem, billingLine),
    };

    stripThinkingIfToolChoiceForced(prepared);

    return JSON.stringify(prepared);
  } catch {
    return raw;
  }
}

/** Prepend the billing header into the system prompt, handling both array and string formats. */
function stripThinkingIfToolChoiceForced(body: Record<string, unknown>): void {
  const toolChoice = body.tool_choice as Record<string, unknown> | undefined;
  const type = toolChoice?.type;
  if (type === "any" || type === "tool") {
    delete body.thinking;
  }
}

function injectBillingHeader(system: unknown, billingLine: string): unknown {
  if (Array.isArray(system)) {
    const filtered = system.filter(
      (s: { text?: string }) => !(typeof s.text === "string" && s.text.includes("x-anthropic-billing-header")),
    );
    return [{ type: "text", text: billingLine }, ...filtered];
  }
  if (typeof system === "string") {
    return `${billingLine}\n${system.replace(/x-anthropic-billing-header:[^\n]*\n?/, "")}`;
  }
  return [{ type: "text", text: billingLine }];
}

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
