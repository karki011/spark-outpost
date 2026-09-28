import type { TicketSourceId } from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export type TicketAction =
  'connect' | 'disconnect' | 'settings' | 'start' | 'transition' | 'comment' | 'link_pr';

export interface TicketEvent {
  source: TicketSourceId;
  action: TicketAction;
  ticketKey?: string | null;
  taskId?: string | null;
  outcome: 'succeeded' | 'skipped' | 'failed';
  detail?: Record<string, unknown>;
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
}
