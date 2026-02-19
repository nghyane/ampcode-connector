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

export interface StatsSnapshot {
  totalRequests: number;
  requestsByRoute: Partial<Record<RouteDecision, number>>;
  count429: number;
  averageDurationMs: number;
  uptimeMs: number;
}

export class StatsRecorder {
  private readonly maxEntries: number;
  private buffer: RequestEntry[] = [];
  private writeIndex = 0;
  private totalCount = 0;
  private readonly startedAt = Date.now();

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  record(entry: RequestEntry): void {
    if (this.buffer.length < this.maxEntries) {
      this.buffer.push(entry);
    } else {
      this.buffer[this.writeIndex] = entry;
    }
    this.writeIndex = (this.writeIndex + 1) % this.maxEntries;
    this.totalCount++;
  }

  snapshot(): StatsSnapshot {
    const requestsByRoute: Partial<Record<RouteDecision, number>> = {};
    let count429 = 0;
    let totalDuration = 0;

    for (const entry of this.buffer) {
      requestsByRoute[entry.route] = (requestsByRoute[entry.route] ?? 0) + 1;
      if (entry.statusCode === 429) count429++;
      totalDuration += entry.durationMs;
    }

    return {
      totalRequests: this.totalCount,
      requestsByRoute,
      count429,
      averageDurationMs: this.buffer.length > 0 ? totalDuration / this.buffer.length : 0,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  recentRequests(n: number): RequestEntry[] {
    const count = Math.min(n, this.buffer.length);
    if (count === 0) return [];

    const result: RequestEntry[] = [];
    let idx = (this.writeIndex - count + this.buffer.length) % this.buffer.length;
    for (let i = 0; i < count; i++) {
      result.push(this.buffer[idx]!);
      idx = (idx + 1) % this.buffer.length;
    }
    return result;
  }

  reset(): void {
    this.buffer = [];
    this.writeIndex = 0;
    this.totalCount = 0;
  }
}

/** Singleton instance for production use. */
export const stats = new StatsRecorder();
