/** Single source of truth — no magic strings scattered across files. */

import { execFileSync } from "node:child_process";

export const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_DAILY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const AUTOPUSH_ENDPOINT = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const DEFAULT_ANTIGRAVITY_PROJECT = "rising-fact-p41fc";

export const ANTHROPIC_API_URL = "https://api.anthropic.com";
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

/** Codex-specific headers required by the ChatGPT backend. */
export const codexHeaders = {
  BETA: "OpenAI-Beta",
  ACCOUNT_ID: "chatgpt-account-id",
  ORIGINATOR: "originator",
  SESSION_ID: "session_id",
  CONVERSATION_ID: "conversation_id",
} as const;

export const CODEX_CLI_VERSION = detectCodexCliVersion();

export function codexUserAgent(version = CODEX_CLI_VERSION): string {
  return `codex_cli_rs/${version} (${codexPlatformDescription()})`;
}

export const codexHeaderValues = {
  BETA_RESPONSES: "responses=experimental",
  ORIGINATOR: "codex_cli_rs",
  USER_AGENT: codexUserAgent(),
} as const;

/** Map Amp CLI paths → ChatGPT backend paths.
 *  Both /v1/responses and /v1/chat/completions route to /codex/responses. */
export const codexPathMap: Record<string, string> = {
  "/v1/responses": "/codex/responses",
  "/v1/chat/completions": "/codex/responses",
} as const;
export const DEFAULT_AMP_UPSTREAM_URL = "https://ampcode.com";

export const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
export const CLAUDE_CODE_VERSION = "2.1.77";

export const claudeCodeBetas = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
] as const;

export const filteredBetaFeatures = ["fast-mode-2026-02-01"] as const;

function detectCodexCliVersion(): string {
  const override = process.env.AMPCODE_CONNECTOR_CODEX_CLI_VERSION?.trim();
  if (override) return override;

  try {
    const output = execFileSync("codex", ["--version"], { encoding: "utf8", timeout: 2000 }).trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1]!;
  } catch {
    // Fall back to the first Codex CLI version known to support gpt-5.5.
  }

  return "0.125.0";
}

function codexPlatformDescription(): string {
  if (process.platform === "darwin") {
    const version = macOsVersion();
    return version ? `Mac OS ${version}; ${process.arch}` : `Mac OS; ${process.arch}`;
  }

  if (process.platform === "win32") return `Windows; ${process.arch}`;
  if (process.platform === "linux") return `Linux; ${process.arch}`;
  return `${process.platform}; ${process.arch}`;
}

function macOsVersion(): string | null {
  try {
    return execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 1000 }).trim();
  } catch {
    return null;
  }
}

export const modelFieldPaths = [
  "model",
  "message.model",
  "modelVersion",
  "response.model",
  "response.modelVersion",
] as const;

export const passthroughPrefixes = [
  "/api/internal",
  "/api/user",
  "/api/auth",
  "/api/meta",
  "/api/ads",
  "/api/telemetry",
  "/api/threads",
  "/api/otel",
  "/api/tab",
  "/api/durable-thread-workers",
] as const;

/** Browser routes — redirect to ampcode.com (auth cookies need correct domain). */
export const browserPrefixes = ["/auth", "/threads", "/docs", "/settings"] as const;

export const passthroughExact = ["/threads.rss", "/news.rss"] as const;
