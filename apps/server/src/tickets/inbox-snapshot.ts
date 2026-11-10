import type { TicketInbox, TicketSourceProblem } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { TicketFacts } from './attention.ts';

export const SNAPSHOT_TTL_MS = 60_000;

export interface InboxSnapshot {
  at: number;
  facts: readonly TicketFacts[];
  errors: TicketSourceProblem[];
  sources: TicketInbox['sources'];
  truncated: TicketInbox['truncated'];
  syncedAt: string;
}

const snapshots = new WeakMap<object, Map<string, InboxSnapshot>>();

export function rememberInbox(db: Queryable, workspaceId: string, snapshot: InboxSnapshot): void {
  const byWorkspace = snapshots.get(db) ?? new Map<string, InboxSnapshot>();
  byWorkspace.set(workspaceId, snapshot);
  snapshots.set(db, byWorkspace);
}

export function recallInbox(db: Queryable, workspaceId: string, now: Date): InboxSnapshot | null {
  const snapshot = snapshots.get(db)?.get(workspaceId);
  if (!snapshot || now.getTime() - snapshot.at > SNAPSHOT_TTL_MS) return null;
  return snapshot;
}
