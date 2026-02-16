/**
 * Route decision: local provider (free) or Amp upstream (paid).
 *
 * Pure provider-name switch. Amp CLI already routes to the correct provider
 * endpoint with SDK-formatted body — proxy only swaps the auth token.
 * For Google: try gemini first, fall back to antigravity.
 */

import type { ProxyConfig } from "../config/config.ts";
import { provider as anthropic } from "../providers/anthropic.ts";
import { provider as antigravity } from "../providers/antigravity.ts";
import type { Provider } from "../providers/base.ts";
import { provider as codex } from "../providers/codex.ts";
import { provider as gemini } from "../providers/gemini.ts";
import { logger, type RouteDecision } from "../utils/logger.ts";

export interface RouteResult {
  decision: RouteDecision;
  provider: string;
  model: string;
  handler: Provider | null;
}

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  available: boolean;
  expiresAt: number;
}

const availabilityCache = new Map<string, CacheEntry>();

function available(p: Provider): boolean {
  const cached = availabilityCache.get(p.name);
  if (cached && Date.now() < cached.expiresAt) return cached.available;

  const result = p.isAvailable();
  availabilityCache.set(p.name, { available: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

function resolve(ampProvider: string, config: ProxyConfig): Provider | null {
  switch (ampProvider) {
    case "anthropic":
      if (config.providers.anthropic && available(anthropic)) return anthropic;
      break;

    case "openai":
      if (config.providers.codex && available(codex)) return codex;
      break;

    case "google":
      if (!config.providers.google) break;
      if (available(gemini)) return gemini;
      if (available(antigravity)) return antigravity;
      break;
  }

  return null;
}

export function routeRequest(ampProvider: string, model: string | null, config: ProxyConfig): RouteResult {
  const modelStr = model ?? "unknown";
  const handler = resolve(ampProvider, config);

  if (handler) {
    logger.route(handler.routeDecision, ampProvider, modelStr);
    return { decision: handler.routeDecision, provider: ampProvider, model: modelStr, handler };
  }

  logger.route("AMP_UPSTREAM", ampProvider, modelStr);
  return { decision: "AMP_UPSTREAM", provider: ampProvider, model: modelStr, handler: null };
}
