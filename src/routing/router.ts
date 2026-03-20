/**
 * Route decision: local provider (free) or Amp upstream (paid).
 *
 * Multi-account aware:
 * - Thread affinity: same thread sticks to same account
 * - Cooldown: skip 429'd accounts, detect quota exhaustion
 * - Least-connections: prefer accounts with fewer active threads
 * - Google: single pool with internal strategy fallback (gemini/antigravity)
 */

import type { ProviderName } from "../auth/store.ts";
import * as store from "../auth/store.ts";
import type { ProxyConfig } from "../config/config.ts";
import { provider as anthropic } from "../providers/anthropic.ts";
import type { Provider } from "../providers/base.ts";
import { provider as codex } from "../providers/codex.ts";
import { provider as google } from "../providers/google.ts";
import { logger, type RouteDecision } from "../utils/logger.ts";
import { affinity } from "./affinity.ts";
import { cooldown, type QuotaPool } from "./cooldown.ts";

interface ProviderEntry {
  provider: Provider;
  pool: QuotaPool;
  credentialName: ProviderName;
}

/** Maps ampProvider name → list of provider entries (checked against config at lookup time). */
const PROVIDER_REGISTRY = new Map<string, { configKey: keyof ProxyConfig["providers"]; entries: ProviderEntry[] }>([
  [
    "anthropic",
    {
      configKey: "anthropic",
      entries: [{ provider: anthropic, pool: "anthropic", credentialName: "anthropic" }],
    },
  ],
  [
    "openai",
    {
      configKey: "codex",
      entries: [{ provider: codex, pool: "codex", credentialName: "codex" }],
    },
  ],
  [
    "google",
    {
      configKey: "google",
      entries: [{ provider: google, pool: "google", credentialName: "google" }],
    },
  ],
]);

/** Reverse map: QuotaPool → Provider (built once at module init). */
const POOL_TO_PROVIDER = new Map<QuotaPool, Provider>();
for (const [, { entries }] of PROVIDER_REGISTRY) {
  for (const entry of entries) {
    POOL_TO_PROVIDER.set(entry.pool, entry.provider);
  }
}

export interface RouteResult {
  decision: RouteDecision;
  provider: string;
  model: string;
  handler: Provider | null;
  account: number;
  pool: QuotaPool | null;
}

interface Candidate {
  provider: Provider;
  pool: QuotaPool;
  account: number;
}

export function routeRequest(
  ampProvider: string,
  model: string | null,
  config: ProxyConfig,
  threadId?: string,
): RouteResult {
  const modelStr = model ?? "unknown";

  // Early exit if provider is disabled in config
  const reg = PROVIDER_REGISTRY.get(ampProvider);
  if (!reg || !config.providers[reg.configKey]) {
    logger.route("AMP_UPSTREAM", ampProvider, modelStr);
    return result(null, ampProvider, modelStr, 0, null);
  }

  // Check thread affinity (keyed by threadId + ampProvider)
  if (threadId) {
    const pinned = affinity.get(threadId, ampProvider);
    if (pinned && !cooldown.isExhausted(pinned.pool, pinned.account)) {
      const handler = providerForPool(pinned.pool);
      if (handler?.isAvailable(pinned.account)) {
        if (!cooldown.isCoolingDown(pinned.pool, pinned.account)) {
          logger.route(handler.routeDecision, ampProvider, modelStr);
          return result(handler, ampProvider, modelStr, pinned.account, pinned.pool);
        }
        // Burst cooldown — still pinned but cooling, let it fall through to find alternative
      }
    }
    // Affinity broken (exhausted / unavailable) — clear and re-route
    if (pinned) affinity.clear(threadId, ampProvider);
  }

  // Build candidate list
  const candidates = buildCandidates(ampProvider, config);
  if (candidates.length === 0) {
    logger.route("AMP_UPSTREAM", ampProvider, modelStr);
    return result(null, ampProvider, modelStr, 0, null);
  }

  // Pick best candidate: not cooling down, least active threads
  const picked = pickCandidate(candidates);
  if (!picked) {
    logger.route("AMP_UPSTREAM", ampProvider, modelStr);
    return result(null, ampProvider, modelStr, 0, null);
  }

  // Pin thread affinity
  if (threadId) affinity.set(threadId, ampProvider, picked.pool, picked.account);

  logger.route(picked.provider.routeDecision, ampProvider, modelStr);
  return result(picked.provider, ampProvider, modelStr, picked.account, picked.pool);
}

/** Record a failure on the current account and pick the next candidate.
 *  Caller is responsible for recording the failure (429/403) on cooldown before calling. */
export function reroute(
  ampProvider: string,
  model: string | null,
  config: ProxyConfig,
  failedPool: QuotaPool,
  failedAccount: number,
  threadId?: string,
): RouteResult | null {
  if (threadId && cooldown.isExhausted(failedPool, failedAccount)) {
    affinity.clear(threadId, ampProvider);
  }

  const modelStr = model ?? "unknown";
  const candidates = buildCandidates(ampProvider, config);
  const picked = pickCandidate(candidates);

  if (!picked) return null;

  if (threadId) affinity.set(threadId, ampProvider, picked.pool, picked.account);
  logger.route(picked.provider.routeDecision, ampProvider, modelStr);
  return result(picked.provider, ampProvider, modelStr, picked.account, picked.pool);
}

/** Record a successful response — clears cooldown. */
export function recordSuccess(pool: QuotaPool, account: number): void {
  cooldown.recordSuccess(pool, account);
}

export function buildCandidates(ampProvider: string, config: ProxyConfig): Candidate[] {
  const reg = PROVIDER_REGISTRY.get(ampProvider);
  if (!reg || !config.providers[reg.configKey]) return [];

  const candidates: Candidate[] = [];
  for (const entry of reg.entries) {
    addAccountCandidates(candidates, entry.provider, entry.pool, entry.credentialName);
  }
  return candidates;
}

function addAccountCandidates(
  candidates: Candidate[],
  provider: Provider,
  pool: QuotaPool,
  providerName: ProviderName,
): void {
  for (const { account, credentials } of store.getAll(providerName)) {
    if (credentials.refreshToken) {
      candidates.push({ provider, pool, account });
    }
  }
}

function pickCandidate(candidates: Candidate[]): Candidate | null {
  // Filter out cooling-down accounts
  const available = candidates.filter((c) => !cooldown.isCoolingDown(c.pool, c.account));
  if (available.length === 0) return null;

  // Pick the one with least active threads (least-connections)
  // When multiple candidates have the same load, pick randomly for even distribution
  let bestLoad = affinity.activeCount(available[0]!.pool, available[0]!.account);
  let ties: Candidate[] = [available[0]!];

  for (let i = 1; i < available.length; i++) {
    const load = affinity.activeCount(available[i]!.pool, available[i]!.account);
    if (load < bestLoad) {
      bestLoad = load;
      ties = [available[i]!];
    } else if (load === bestLoad) {
      ties.push(available[i]!);
    }
  }

  return ties[Math.floor(Math.random() * ties.length)]!;
}

function providerForPool(pool: QuotaPool): Provider | null {
  return POOL_TO_PROVIDER.get(pool) ?? null;
}

function result(
  handler: Provider | null,
  provider: string,
  model: string,
  account: number,
  pool: QuotaPool | null,
): RouteResult {
  const decision: RouteDecision = handler?.routeDecision ?? "AMP_UPSTREAM";
  return { decision, provider, model, handler, account, pool };
}
