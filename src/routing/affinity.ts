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
const counts = new Map<string, number>();

function key(threadId: string, ampProvider: string): string {
  return `${threadId}\0${ampProvider}`;
}

function countKey(pool: QuotaPool, account: number): string {
  return `${pool}:${account}`;
}

function incCount(pool: QuotaPool, account: number): void {
  const k = countKey(pool, account);
  counts.set(k, (counts.get(k) ?? 0) + 1);
}

function decCount(pool: QuotaPool, account: number): void {
  const k = countKey(pool, account);
  const v = (counts.get(k) ?? 0) - 1;
  if (v <= 0) counts.delete(k);
  else counts.set(k, v);
}

export function get(threadId: string, ampProvider: string): AffinityEntry | undefined {
  const k = key(threadId, ampProvider);
  const entry = map.get(k);
  if (!entry) return undefined;
  if (Date.now() - entry.assignedAt > TTL_MS) {
    map.delete(k);
    decCount(entry.pool, entry.account);
    return undefined;
  }
  // Touch: keep affinity alive while thread is active
  entry.assignedAt = Date.now();
  return entry;
}

export function set(threadId: string, ampProvider: string, pool: QuotaPool, account: number): void {
  const k = key(threadId, ampProvider);
  const existing = map.get(k);
  if (existing) {
    if (existing.pool !== pool || existing.account !== account) {
      decCount(existing.pool, existing.account);
      incCount(pool, account);
    }
  } else {
    incCount(pool, account);
  }
  map.set(k, { pool, account, assignedAt: Date.now() });
}

/** Break affinity when account is exhausted — allow re-routing. */
export function clear(threadId: string, ampProvider: string): void {
  const k = key(threadId, ampProvider);
  const existing = map.get(k);
  if (existing) {
    decCount(existing.pool, existing.account);
    map.delete(k);
  }
}

/** Count active threads pinned to a specific (pool, account). */
export function activeCount(pool: QuotaPool, account: number): number {
  return counts.get(countKey(pool, account)) ?? 0;
}

let _cleanupTimer: Timer | null = null;

/** Start periodic cleanup of expired entries. Call once at server startup. */
export function startCleanup(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of map) {
      if (now - entry.assignedAt > TTL_MS) {
        map.delete(k);
        decCount(entry.pool, entry.account);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}
