/** Thread → (quotaPool, account) affinity map.
 *  Ensures a thread sticks to the same account for session consistency. */

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

export function get(threadId: string): AffinityEntry | undefined {
  const entry = map.get(threadId);
  if (!entry) return undefined;
  if (Date.now() - entry.assignedAt > TTL_MS) {
    map.delete(threadId);
    return undefined;
  }
  return entry;
}

export function set(threadId: string, pool: QuotaPool, account: number): void {
  map.set(threadId, { pool, account, assignedAt: Date.now() });
}

/** Break affinity when account is exhausted — allow re-routing. */
export function clear(threadId: string): void {
  map.delete(threadId);
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
  for (const [threadId, entry] of map) {
    if (now - entry.assignedAt > TTL_MS) map.delete(threadId);
  }
}, CLEANUP_INTERVAL_MS);
