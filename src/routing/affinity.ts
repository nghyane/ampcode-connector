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

const map = new Map<string, AffinityEntry>();

function key(threadId: string, ampProvider: string): string {
  return `${threadId}\0${ampProvider}`;
}

export function get(threadId: string, ampProvider: string): AffinityEntry | undefined {
  const entry = map.get(key(threadId, ampProvider));
  if (!entry) return undefined;
  if (Date.now() - entry.assignedAt > TTL_MS) {
    map.delete(key(threadId, ampProvider));
    return undefined;
  }
  // Touch: keep affinity alive while thread is active
  entry.assignedAt = Date.now();
  return entry;
}

export function set(threadId: string, ampProvider: string, pool: QuotaPool, account: number): void {
  map.set(key(threadId, ampProvider), { pool, account, assignedAt: Date.now() });
}

/** Break affinity when account is exhausted — allow re-routing. */
export function clear(threadId: string, ampProvider: string): void {
  map.delete(key(threadId, ampProvider));
}

/** Count active threads pinned to a specific (pool, account). */
export function activeCount(pool: QuotaPool, account: number): number {
  const now = Date.now();
  let count = 0;
  for (const entry of map.values()) {
    if (entry.pool === pool && entry.account === account && now - entry.assignedAt <= TTL_MS) {
      count++;
    }
  }
  return count;
}

/** Periodic cleanup of expired entries. */
setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of map) {
    if (now - entry.assignedAt > TTL_MS) map.delete(k);
  }
}, CLEANUP_INTERVAL_MS);
