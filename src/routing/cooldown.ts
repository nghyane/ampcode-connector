/** Per-(quotaPool, account) cooldown tracking.
 *  Distinguishes short burst 429s from quota exhaustion. */

import { logger } from "../utils/logger.ts";

export type QuotaPool = "anthropic" | "codex" | "gemini" | "antigravity";

interface CooldownEntry {
  until: number;
  exhausted: boolean;
  consecutive429: number;
}

/** When detected as exhausted, cooldown for this long. */
/** 403 = account disabled/revoked — long cooldown. */
const FORBIDDEN_COOLDOWN_MS = 24 * 3600_000;
const EXHAUSTED_COOLDOWN_MS = 2 * 3600_000;
/** Retry-After threshold (seconds) above which we consider quota exhausted. */
const EXHAUSTED_THRESHOLD_S = 300;
/** Consecutive 429 count to trigger exhaustion detection. */
const EXHAUSTED_CONSECUTIVE = 3;
/** Default burst cooldown when no Retry-After header. */
const DEFAULT_BURST_S = 30;

export class CooldownTracker {
  private entries = new Map<string, CooldownEntry>();

  private key(pool: QuotaPool, account: number): string {
    return `${pool}:${account}`;
  }

  private getEntry(pool: QuotaPool, account: number): CooldownEntry | undefined {
    const k = this.key(pool, account);
    const entry = this.entries.get(k);
    if (!entry) return undefined;
    if (Date.now() >= entry.until) {
      this.entries.delete(k);
      return undefined;
    }
    return entry;
  }

  isCoolingDown(pool: QuotaPool, account: number): boolean {
    return this.getEntry(pool, account) !== undefined;
  }

  isExhausted(pool: QuotaPool, account: number): boolean {
    return this.getEntry(pool, account)?.exhausted ?? false;
  }

  record429(pool: QuotaPool, account: number, retryAfterSeconds?: number): void {
    const k = this.key(pool, account);
    const entry = this.entries.get(k) ?? { until: 0, exhausted: false, consecutive429: 0 };

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

    this.entries.set(k, entry);
  }

  /** 403 = account forbidden/revoked. Immediately disable for 24h. */
  record403(pool: QuotaPool, account: number): void {
    const k = this.key(pool, account);
    this.entries.set(k, { until: Date.now() + FORBIDDEN_COOLDOWN_MS, exhausted: true, consecutive429: 0 });
    logger.warn(`Account disabled (403): ${k}`, { cooldownHours: FORBIDDEN_COOLDOWN_MS / 3600_000 });
  }

  recordSuccess(pool: QuotaPool, account: number): void {
    this.entries.delete(this.key(pool, account));
  }

  reset(): void {
    this.entries.clear();
  }
}

/** Singleton instance for production use. */
export const cooldown = new CooldownTracker();

/** Parse Retry-After header (seconds or HTTP-date). */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}
