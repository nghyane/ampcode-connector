/** Retry logic: cache-preserving wait + reroute after retryable failures (429/403). */

import type { ProxyConfig } from "../config/config.ts";
import type { ParsedBody } from "../server/body.ts";
import { logger } from "../utils/logger.ts";
import { cooldown, parseRetryAfter, type QuotaPool } from "./cooldown.ts";
import { type RouteResult, recordSuccess, reroute } from "./router.ts";

/** Max reroute attempts before falling back to upstream. */
const MAX_REROUTE_ATTEMPTS = 4;
/** Max seconds to wait-and-retry on the same account (preserves prompt cache). */
const CACHE_PRESERVE_WAIT_MAX_S = 10;

/** Status codes that trigger rerouting to a different account/pool. */
const REROUTABLE_STATUSES = new Set([429, 403]);

interface RerouteContext {
  providerName: string;
  ampModel: string | null;
  config: ProxyConfig;
  sub: string;
  body: ParsedBody;
  headers: Headers;
  rewrite: ((data: string) => string) | undefined;
  threadId?: string;
}

/** Wait briefly and retry on the same account to preserve prompt cache (429 only). */
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
    cooldown.record429(route.pool!, route.account, nextRetryAfter);
  }
  return null;
}

/** Reroute to different accounts/pools after a retryable failure (429/403). */
export async function tryReroute(
  ctx: RerouteContext,
  initialRoute: RouteResult,
  status: number,
): Promise<Response | null> {
  recordFailure(initialRoute.pool!, initialRoute.account, status);

  let currentPool = initialRoute.pool!;
  let currentAccount = initialRoute.account;

  for (let attempt = 0; attempt < MAX_REROUTE_ATTEMPTS; attempt++) {
    const next = reroute(ctx.providerName, ctx.ampModel, ctx.config, currentPool, currentAccount, ctx.threadId);
    if (!next?.handler) break;

    logger.info(`REROUTE (${status}) -> ${next.decision} account=${next.account}`);
    const response = await next.handler.forward(ctx.sub, ctx.body, ctx.headers, ctx.rewrite, next.account);

    if (REROUTABLE_STATUSES.has(response.status) && next.pool) {
      recordFailure(next.pool, next.account, response.status);
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

/** Record the appropriate cooldown based on status code. */
function recordFailure(pool: QuotaPool, account: number, status: number): void {
  if (status === 403) {
    cooldown.record403(pool, account);
  } else {
    cooldown.record429(pool, account);
  }
}
