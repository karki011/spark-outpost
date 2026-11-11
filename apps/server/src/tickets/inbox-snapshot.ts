import type { TicketInbox, TicketSourceProblem } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { afterTicketEvent } from '../persistence/ticket-events.ts';
import type { TicketFacts } from './attention.ts';
import { forgetPullStatuses } from './pull-status-cache.ts';
import { forgetSource } from './source-backoff.ts';

export const SNAPSHOT_TTL_MS = 60_000;
export const FRESH_WINDOW_MS = 20_000;

export interface InboxSnapshot {
  at: number;
  generation: number;
  facts: readonly TicketFacts[];
  errors: TicketSourceProblem[];
  sources: TicketInbox['sources'];
  truncated: TicketInbox['truncated'];
  syncedAt: string;
}

interface Running {
  generation: number;
  promise: Promise<InboxSnapshot>;
}

interface WorkspaceCache {
  generation: number;
  snapshot: InboxSnapshot | null;
  running: Running | null;
}

const caches = new WeakMap<Queryable, Map<string, WorkspaceCache>>();

function cacheOf(db: Queryable, workspaceId: string): WorkspaceCache {
  const byWorkspace = caches.get(db) ?? new Map<string, WorkspaceCache>();
  caches.set(db, byWorkspace);
  const known = byWorkspace.get(workspaceId);
  if (known) return known;
  const created: WorkspaceCache = { generation: 0, snapshot: null, running: null };
  byWorkspace.set(workspaceId, created);
  return created;
}

export function forgetInbox(db: Queryable, workspaceId: string): void {
  cacheOf(db, workspaceId).generation += 1;
}

export function pullRequestChanged(db: Queryable, workspaceId: string): void {
  forgetInbox(db, workspaceId);
  forgetPullStatuses(db);
}

export function recallInbox(
  db: Queryable,
  workspaceId: string,
  now: Date,
  maxAgeMs = SNAPSHOT_TTL_MS,
): InboxSnapshot | null {
  const cache = cacheOf(db, workspaceId);
  const snapshot = cache.snapshot;
  if (!snapshot || snapshot.generation !== cache.generation) return null;
  return now.getTime() - snapshot.at > maxAgeMs ? null : snapshot;
}

export function rememberInbox(db: Queryable, workspaceId: string, snapshot: InboxSnapshot): void {
  cacheOf(db, workspaceId).snapshot = snapshot;
}

export function shareSync(
  db: Queryable,
  workspaceId: string,
  start: (generation: number) => Promise<InboxSnapshot>,
): Promise<InboxSnapshot> {
  const cache = cacheOf(db, workspaceId);
  if (cache.running && cache.running.generation === cache.generation) return cache.running.promise;
  const generation = cache.generation;
  const promise = start(generation).finally(() => {
    if (cache.running?.promise === promise) cache.running = null;
  });
  cache.running = { generation, promise };
  return promise;
}

afterTicketEvent((db, workspaceId, event) => {
  forgetInbox(db, workspaceId);
  if (event.action === 'connect' || event.action === 'disconnect' || event.action === 'settings') {
    forgetSource(db, workspaceId, event.source);
    forgetPullStatuses(db);
  }
});
