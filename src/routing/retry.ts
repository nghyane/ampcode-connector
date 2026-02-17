/** Retry logic: cache-preserving wait + reroute after 429. */

import type { ProxyConfig } from "../config/config.ts";
import type { ParsedBody } from "../server/body.ts";
import { logger } from "../utils/logger.ts";
import { parseRetryAfter, record429 } from "./cooldown.ts";
import { type RouteResult, recordSuccess, rerouteAfter429 } from "./router.ts";

/** Max 429-reroute attempts before falling back to upstream. */
const MAX_REROUTE_ATTEMPTS = 4;
/** Max seconds to wait-and-retry on the same account (preserves prompt cache). */
const CACHE_PRESERVE_WAIT_MAX_S = 10;

/** Wait briefly and retry on the same account to preserve prompt cache. */
export async function tryWithCachePreserve(
  route: RouteResult,
  sub: string,
  body: ParsedBody,
  headers: Headers,
  rewrite: ((data: string) => string) | undefined,
  initialResponse: Response,
): Promise<Response | null> {
  const retryAfter = parseRetryAfter(initialResponse.headers.get("retry-after"));
  if (retryAfter === undefined || retryAfter > CACHE_PRESERVE_WAIT_MAX_S) return null;

  logger.debug(`Waiting ${retryAfter}s to preserve prompt cache on account=${route.account}`);
  await Bun.sleep(retryAfter * 1000);
  const response = await route.handler!.forward(sub, body, headers, rewrite, route.account);

  if (response.status !== 429 && response.status !== 401) {
    recordSuccess(route.pool!, route.account);
    return response;
  }
  if (response.status === 429) {
    const nextRetryAfter = parseRetryAfter(response.headers.get("retry-after"));
    record429(route.pool!, route.account, nextRetryAfter);
  }
  return null;
}

/** Reroute to different accounts/pools after 429 (cache loss accepted). */
export async function tryReroute(
  providerName: string,
  ampModel: string | null,
  config: ProxyConfig,
  initialRoute: RouteResult,
  sub: string,
  body: ParsedBody,
  headers: Headers,
  rewrite: ((data: string) => string) | undefined,
  initialResponse: Response,
  threadId?: string,
): Promise<Response | null> {
  const retryAfter = parseRetryAfter(initialResponse.headers.get("retry-after"));
  logger.warn(`429 from ${initialRoute.decision} account=${initialRoute.account}`, { retryAfter });

  let currentPool = initialRoute.pool!;
  let currentAccount = initialRoute.account;

  for (let attempt = 0; attempt < MAX_REROUTE_ATTEMPTS; attempt++) {
    const next = rerouteAfter429(providerName, ampModel, config, currentPool, currentAccount, retryAfter, threadId);
    if (!next) break;

    logger.info(`REROUTE -> ${next.decision} account=${next.account}`);
    const response = await next.handler!.forward(sub, body, headers, rewrite, next.account);

    if (response.status === 429 && next.pool) {
      const nextRetryAfter = parseRetryAfter(response.headers.get("retry-after"));
      record429(next.pool, next.account, nextRetryAfter);
      currentPool = next.pool;
      currentAccount = next.account;
      continue;
    }

    if (response.status !== 401) {
      if (next.pool) recordSuccess(next.pool, next.account);
      return response;
    }
    break;
  }

  return null;
}
