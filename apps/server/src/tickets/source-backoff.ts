import type { TicketSourceId, TicketSummary } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export interface LastGood {
  tickets: readonly TicketSummary[];
  truncated: boolean;
}

export interface Backoff {
  until: number;
  status: number;
}

interface SourceMemory {
  until: number;
  status: number;
  lastGood: LastGood | null;
}

const memories = new WeakMap<Queryable, Map<string, SourceMemory>>();

const keyOf = (workspaceId: string, source: TicketSourceId) => `${workspaceId}:${source}`;

function memoryOf(db: Queryable, workspaceId: string, source: TicketSourceId): SourceMemory {
  const bySource = memories.get(db) ?? new Map<string, SourceMemory>();
  memories.set(db, bySource);
  const key = keyOf(workspaceId, source);
  const known = bySource.get(key);
  if (known) return known;
  const created: SourceMemory = { until: 0, status: 0, lastGood: null };
  bySource.set(key, created);
  return created;
}

export function backoffUntil(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  now: Date,
): Backoff | null {
  const { until, status } = memoryOf(db, workspaceId, source);
  return now.getTime() < until ? { until, status } : null;
}

export function startBackoff(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  backoff: Backoff,
): void {
  Object.assign(memoryOf(db, workspaceId, source), backoff);
}

export function recordGoodRead(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  good: LastGood,
): void {
  const memory = memoryOf(db, workspaceId, source);
  memory.until = 0;
  memory.lastGood = good;
}

export function lastGoodRead(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
): LastGood | null {
  return memoryOf(db, workspaceId, source).lastGood;
}

export function forgetSource(db: Queryable, workspaceId: string, source: TicketSourceId): void {
  memories.get(db)?.delete(keyOf(workspaceId, source));
}
