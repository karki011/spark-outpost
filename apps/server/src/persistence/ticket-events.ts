import type { TicketLastSync, TicketSourceId } from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';
import { ticketRef } from './tickets.ts';

export type TicketAction =
  | 'connect'
  | 'disconnect'
  | 'settings'
  | 'start'
  | 'transition'
  | 'comment'
  | 'link_pr'
  | 'assign'
  | 'create';

export interface TicketEvent {
  source: TicketSourceId;
  action: TicketAction;
  ticketKey?: string | null;
  taskId?: string | null;
  outcome: 'succeeded' | 'skipped' | 'failed';
  detail?: Record<string, unknown>;
}

type TicketEventListener = (db: Queryable, workspaceId: string, event: TicketEvent) => void;

const listeners: TicketEventListener[] = [];

export function afterTicketEvent(listener: TicketEventListener): void {
  listeners.push(listener);
}

export async function recordTicketEvent(
  db: Queryable,
  workspaceId: string,
  event: TicketEvent,
): Promise<void> {
  await db.query(
    `INSERT INTO ticket_events (id, workspace_id, source, action, ticket_key, task_id, outcome, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newId(),
      workspaceId,
      event.source,
      event.action,
      event.ticketKey ?? null,
      event.taskId ?? null,
      event.outcome,
      JSON.stringify(redactValue(event.detail ?? {})),
    ],
  );
  for (const listener of listeners) listener(db, workspaceId, event);
}

interface LastSyncRow {
  source: TicketSourceId;
  ticket_key: string;
  action: TicketLastSync['action'];
  outcome: TicketLastSync['outcome'];
  message: string | null;
  at: Date;
}

export async function lastTicketSyncs(
  db: Queryable,
  workspaceId: string,
  refs: readonly string[],
): Promise<Map<string, TicketLastSync>> {
  const { rows } = await db.query<LastSyncRow>(
    `SELECT DISTINCT ON (source, ticket_key) source, ticket_key, action, outcome,
       detail->>'message' AS message, at
     FROM ticket_events
     WHERE workspace_id = $1 AND action IN ('transition', 'link_pr', 'assign')
       AND (source || ':' || ticket_key) = ANY($2::text[])
     ORDER BY source, ticket_key, at DESC`,
    [workspaceId, refs],
  );
  return new Map(
    rows.map((row) => [
      ticketRef(row.source, row.ticket_key),
      { action: row.action, outcome: row.outcome, message: row.message, at: row.at.toISOString() },
    ]),
  );
}

export async function mergeMoveTried(
  db: Queryable,
  workspaceId: string,
  ticket: { source: TicketSourceId; key: string },
  pullUrl: string,
): Promise<boolean> {
  const { rows } = await db.query<{ tried: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ticket_events
       WHERE workspace_id = $1 AND source = $2 AND ticket_key = $3 AND action = 'transition'
         AND detail->>'mergedPullRequest' = $4
     ) AS tried`,
    [workspaceId, ticket.source, ticket.key, pullUrl],
  );
  return rows[0]?.tried === true;
}

export async function whileClaimingMergeMove<T>(
  db: Db,
  workspaceId: string,
  ticket: { source: TicketSourceId; key: string },
  pullUrl: string,
  work: () => Promise<T>,
): Promise<T | null> {
  return withTransaction(db, async (client) => {
    const claim = `merge-move:${workspaceId}:${ticket.source}:${ticket.key}:${pullUrl}`;
    const { rows } = await client.query<{ claimed: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS claimed',
      [claim],
    );
    if (rows[0]?.claimed !== true) return null;
    if (await mergeMoveTried(client, workspaceId, ticket, pullUrl)) return null;
    return work();
  });
}
