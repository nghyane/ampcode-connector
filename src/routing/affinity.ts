/** Thread+provider → (quotaPool, account) affinity map.
 *  Ensures a thread sticks to the same account per provider for session consistency.
 *  Key is composite (threadId, ampProvider) so a single thread can hold
 *  independent affinities for different providers (e.g. anthropic AND google). */

import type { QuotaPool } from "./cooldown.ts";

interface AffinityEntry {
  pool: QuotaPool;
  account: number;
  assignedAt: number;
}

/** Affinity expires after 2 hours of inactivity. */
const TTL_MS = 2 * 3600_000;
/** Cleanup stale entries every 10 minutes. */
const CLEANUP_INTERVAL_MS = 10 * 60_000;

class AffinityStore {
  private map = new Map<string, AffinityEntry>();
  private counts = new Map<string, number>();
  private cleanupTimer: Timer | null = null;

  private key(threadId: string, ampProvider: string): string {
    return `${threadId}\0${ampProvider}`;
  }

  private countKey(pool: QuotaPool, account: number): string {
    return `${pool}:${account}`;
  }

  private incCount(pool: QuotaPool, account: number): void {
    const k = this.countKey(pool, account);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }

  private decCount(pool: QuotaPool, account: number): void {
    const k = this.countKey(pool, account);
    const v = (this.counts.get(k) ?? 0) - 1;
    if (v <= 0) this.counts.delete(k);
    else this.counts.set(k, v);
  }

  private removeExpired(k: string, entry: AffinityEntry): void {
    this.map.delete(k);
    this.decCount(entry.pool, entry.account);
  }

  /** Read affinity without side effects. Returns undefined if expired or missing. */
  peek(threadId: string, ampProvider: string): AffinityEntry | undefined {
    const k = this.key(threadId, ampProvider);
    const entry = this.map.get(k);
    if (!entry) return undefined;
    if (Date.now() - entry.assignedAt > TTL_MS) {
      this.removeExpired(k, entry);
      return undefined;
    }
    return entry;
  }

  /** Read affinity and touch (extend TTL). */
  get(threadId: string, ampProvider: string): AffinityEntry | undefined {
    const entry = this.peek(threadId, ampProvider);
    if (entry) entry.assignedAt = Date.now();
    return entry;
  }

  set(threadId: string, ampProvider: string, pool: QuotaPool, account: number): void {
    const k = this.key(threadId, ampProvider);
    const existing = this.map.get(k);
    if (existing) {
      if (existing.pool !== pool || existing.account !== account) {
        this.decCount(existing.pool, existing.account);
        this.incCount(pool, account);
      }
    } else {
      this.incCount(pool, account);
    }
    this.map.set(k, { pool, account, assignedAt: Date.now() });
  }

  /** Break affinity when account is exhausted — allow re-routing. */
  clear(threadId: string, ampProvider: string): void {
    const k = this.key(threadId, ampProvider);
    const existing = this.map.get(k);
    if (existing) {
      this.decCount(existing.pool, existing.account);
      this.map.delete(k);
    }
  }

  /** Count active threads pinned to a specific (pool, account). */
  activeCount(pool: QuotaPool, account: number): number {
    return this.counts.get(this.countKey(pool, account)) ?? 0;
  }

  /** Start periodic cleanup of expired entries. Call once at server startup. */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, entry] of this.map) {
        if (now - entry.assignedAt > TTL_MS) {
          this.removeExpired(k, entry);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  reset(): void {
    this.map.clear();
    this.counts.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/** Singleton instance for production use. */
export const affinity = new AffinityStore();
