/** Request statistics tracking with ring buffer. */

import type { RouteDecision } from "../utils/logger.ts";

export interface RequestEntry {
  timestamp: string;
  route: RouteDecision;
  provider: string;
  model: string;
  statusCode: number;
  durationMs: number;
}

const MAX_ENTRIES = 1000;
const buffer: RequestEntry[] = [];
let writeIndex = 0;
let totalCount = 0;
const startedAt = Date.now();

export function record(entry: RequestEntry): void {
  if (buffer.length < MAX_ENTRIES) {
    buffer.push(entry);
  } else {
    buffer[writeIndex] = entry;
  }
  writeIndex = (writeIndex + 1) % MAX_ENTRIES;
  totalCount++;
}

export interface StatsSnapshot {
  totalRequests: number;
  requestsByRoute: Partial<Record<RouteDecision, number>>;
  count429: number;
  averageDurationMs: number;
  uptimeMs: number;
}

export function snapshot(): StatsSnapshot {
  const requestsByRoute: Partial<Record<RouteDecision, number>> = {};
  let count429 = 0;
  let totalDuration = 0;

  for (const entry of buffer) {
    requestsByRoute[entry.route] = (requestsByRoute[entry.route] ?? 0) + 1;
    if (entry.statusCode === 429) count429++;
    totalDuration += entry.durationMs;
  }

  return {
    totalRequests: totalCount,
    requestsByRoute,
    count429,
    averageDurationMs: buffer.length > 0 ? totalDuration / buffer.length : 0,
    uptimeMs: Date.now() - startedAt,
  };
}

export function recentRequests(n: number): RequestEntry[] {
  const count = Math.min(n, buffer.length);
  if (count === 0) return [];

  const result: RequestEntry[] = [];
  let idx = (writeIndex - count + buffer.length) % buffer.length;
  for (let i = 0; i < count; i++) {
    result.push(buffer[idx]!);
    idx = (idx + 1) % buffer.length;
  }
  return result;
}
