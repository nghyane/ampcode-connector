/** Per-(quotaPool, account) cooldown tracking.
 *  Distinguishes short burst 429s from quota exhaustion. */

import { logger } from "../utils/logger.ts";

export type QuotaPool = "anthropic" | "codex" | "gemini" | "antigravity";

interface CooldownEntry {
  until: number;
  exhausted: boolean;
  consecutive429: number;
}

/** Consecutive 429s within this window count toward exhaustion detection. */
const CONSECUTIVE_WINDOW_MS = 2 * 60_000;
/** When detected as exhausted, cooldown for this long. */
const EXHAUSTED_COOLDOWN_MS = 2 * 3600_000;
/** Retry-After threshold (seconds) above which we consider quota exhausted. */
const EXHAUSTED_THRESHOLD_S = 300;
/** Consecutive 429 count to trigger exhaustion detection. */
const EXHAUSTED_CONSECUTIVE = 3;
/** Default burst cooldown when no Retry-After header. */
const DEFAULT_BURST_S = 30;

const entries = new Map<string, CooldownEntry>();

function key(pool: QuotaPool, account: number): string {
  return `${pool}:${account}`;
}

export function isCoolingDown(pool: QuotaPool, account: number): boolean {
  const entry = entries.get(key(pool, account));
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    entries.delete(key(pool, account));
    return false;
  }
  return true;
}

export function isExhausted(pool: QuotaPool, account: number): boolean {
  const entry = entries.get(key(pool, account));
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    entries.delete(key(pool, account));
    return false;
  }
  return entry.exhausted;
}

export function record429(pool: QuotaPool, account: number, retryAfterSeconds?: number): void {
  const k = key(pool, account);
  const entry = entries.get(k) ?? { until: 0, exhausted: false, consecutive429: 0 };

  entry.consecutive429++;
  const retryAfter = retryAfterSeconds ?? DEFAULT_BURST_S;

  if (retryAfter > EXHAUSTED_THRESHOLD_S || entry.consecutive429 >= EXHAUSTED_CONSECUTIVE) {
    entry.exhausted = true;
    entry.until = Date.now() + EXHAUSTED_COOLDOWN_MS;
    logger.warn(`Quota exhausted: ${k}`, { cooldownMinutes: EXHAUSTED_COOLDOWN_MS / 60_000 });
  } else {
    entry.until = Date.now() + retryAfter * 1000;
    logger.debug(`Burst cooldown: ${k}`, { retryAfterSeconds: retryAfter });
  }

  entries.set(k, entry);
}

export function recordSuccess(pool: QuotaPool, account: number): void {
  const k = key(pool, account);
  const entry = entries.get(k);
  if (entry) {
    entry.consecutive429 = 0;
    entry.exhausted = false;
    entries.delete(k);
  }
}

/** Parse Retry-After header (seconds or HTTP-date). */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}
