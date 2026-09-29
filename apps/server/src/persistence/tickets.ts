import type {
  TicketSourceId,
  TicketStatus,
  TicketSummary,
  TicketWork,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface CachedTicket {
  source: TicketSourceId;
  key: string;
  title: string;
  status: TicketStatus;
  statusName: string;
  url: string;
}

export const ticketRef = (source: TicketSourceId, key: string) => `${source}:${key}`;

export async function cacheTickets(
  db: Queryable,
  workspaceId: string,
  tickets: readonly TicketSummary[],
  options: { assignedToMe?: boolean } = {},
): Promise<void> {
  if (tickets.length === 0) return;
  await db.query(
    `INSERT INTO tickets (workspace_id, source, key, title, status, status_name, url, updated_at,
       status_since, first_seen_assigned_at)
     SELECT $1, t.source, t.key, t.title, t.status, t.status_name, t.url, t.updated_at,
       t.updated_at, CASE WHEN $3 THEN now() END
     FROM jsonb_to_recordset($2::jsonb) AS t (source text, key text, title text, status text,
       status_name text, url text, updated_at timestamptz)
     ON CONFLICT (workspace_id, source, key) DO UPDATE SET title = EXCLUDED.title,
       status = EXCLUDED.status, status_name = EXCLUDED.status_name, url = EXCLUDED.url,
       updated_at = EXCLUDED.updated_at, cached_at = now(),
       status_since = CASE WHEN tickets.status = EXCLUDED.status
         THEN COALESCE(tickets.status_since, EXCLUDED.status_since) ELSE now() END,
       first_seen_assigned_at = CASE WHEN $3
         THEN COALESCE(tickets.first_seen_assigned_at, now())
         ELSE tickets.first_seen_assigned_at END`,
    [
      workspaceId,
      JSON.stringify(
        tickets.map((ticket) => ({
          source: ticket.source,
          key: ticket.key,
          title: ticket.title,
          status: ticket.status,
          status_name: ticket.statusName,
          url: ticket.url,
          updated_at: ticket.updatedAt,
        })),
      ),
      options.assignedToMe === true,
    ],
  );
}

export interface TicketTimes {
  statusSince: Date | null;
  firstSeenAssignedAt: Date | null;
}

export async function ticketTimes(
  db: Queryable,
  workspaceId: string,
  tickets: readonly { source: TicketSourceId; key: string }[],
): Promise<Map<string, TicketTimes>> {
  const { rows } = await db.query<{
    source: TicketSourceId;
    key: string;
    status_since: Date | null;
    first_seen_assigned_at: Date | null;
  }>(
    `SELECT source, key, status_since, first_seen_assigned_at FROM tickets
     WHERE workspace_id = $1 AND (source || ':' || key) = ANY($2::text[])`,
    [workspaceId, tickets.map((ticket) => ticketRef(ticket.source, ticket.key))],
  );
  return new Map(
    rows.map((row) => [
      ticketRef(row.source, row.key),
      { statusSince: row.status_since, firstSeenAssignedAt: row.first_seen_assigned_at },
    ]),
  );
}

export async function setCachedStatus(
  db: Queryable,
  workspaceId: string,
  ticket: { source: TicketSourceId; key: string; status: TicketStatus; statusName: string },
): Promise<void> {
  await db.query(
    `UPDATE tickets SET status_since = CASE WHEN status = $4 THEN status_since ELSE now() END,
       status = $4, status_name = $5, cached_at = now()
     WHERE workspace_id = $1 AND source = $2 AND key = $3`,
    [workspaceId, ticket.source, ticket.key, ticket.status, ticket.statusName],
  );
}

export async function linkTaskTicket(
  db: Queryable,
  workspaceId: string,
  taskId: string,
  ticket: { source: TicketSourceId; key: string },
): Promise<void> {
  await db.query(
    `INSERT INTO task_tickets (task_id, workspace_id, source, ticket_key) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [taskId, workspaceId, ticket.source, ticket.key],
  );
}

export async function ticketsForTask(db: Queryable, taskId: string): Promise<CachedTicket[]> {
  const { rows } = await db.query<{
    source: TicketSourceId;
    key: string;
    title: string;
    status: TicketStatus;
    status_name: string;
    url: string;
  }>(
    `SELECT t.source, t.key, t.title, t.status, t.status_name, t.url FROM task_tickets tt
     JOIN tickets t ON t.workspace_id = tt.workspace_id AND t.source = tt.source
       AND t.key = tt.ticket_key
     WHERE tt.task_id = $1 ORDER BY tt.created_at, t.key`,
    [taskId],
  );
  return rows.map((row) => ({
    source: row.source,
    key: row.key,
    title: row.title,
    status: row.status,
    statusName: row.status_name,
    url: row.url,
  }));
}

export async function openTicketTask(
  db: Queryable,
  conversationId: string,
  ticket: { source: TicketSourceId; key: string },
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT t.id FROM tasks t JOIN task_tickets tt ON tt.task_id = t.id
     WHERE t.conversation_id = $1 AND tt.source = $2 AND tt.ticket_key = $3
     ORDER BY t.created_at DESC LIMIT 1`,
    [conversationId, ticket.source, ticket.key],
  );
  return rows[0]?.id ?? null;
}

interface WorkRow {
  source: TicketSourceId;
  ticket_key: string;
  task_id: string;
  conversation_id: string;
  created_at: Date;
  pull_requests: { title: string | null; url: string }[];
}

export async function ticketWork(
  db: Queryable,
  workspaceId: string,
  tickets: readonly { source: TicketSourceId; key: string }[],
): Promise<Map<string, TicketWork[]>> {
  const work = new Map<string, TicketWork[]>();
  if (tickets.length === 0) return work;
  const { rows } = await db.query<WorkRow>(
    `SELECT tt.source, tt.ticket_key, tt.task_id, t.conversation_id, tt.created_at,
       COALESCE(jsonb_agg(jsonb_build_object('title', l.title, 'url', l.url)
         ORDER BY l.created_at) FILTER (WHERE l.id IS NOT NULL), '[]') AS pull_requests
     FROM task_tickets tt
     JOIN tasks t ON t.id = tt.task_id
     LEFT JOIN task_links l ON l.task_id = tt.task_id AND l.kind = 'pr'
     WHERE tt.workspace_id = $1
       AND (tt.source || ':' || tt.ticket_key) = ANY($2::text[])
     GROUP BY tt.source, tt.ticket_key, tt.task_id, t.conversation_id, tt.created_at
     ORDER BY tt.created_at`,
    [workspaceId, tickets.map((ticket) => ticketRef(ticket.source, ticket.key))],
  );
  for (const row of rows) {
    const ref = ticketRef(row.source, row.ticket_key);
    const list = work.get(ref) ?? [];
    list.push({
      taskId: row.task_id,
      conversationId: row.conversation_id,
      startedAt: row.created_at.toISOString(),
      pullRequests: row.pull_requests.map((pull) => ({
        title: pull.title ?? pull.url,
        url: pull.url,
      })),
    });
    work.set(ref, list);
  }
  return work;
}
