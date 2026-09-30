import type {
  ChatTicket,
  ChatTickets,
  TicketSourceId,
  TicketStatus,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export type ChatTicketState = 'linked' | 'suggested' | 'unlinked';
export type ChatTicketLinkedBy = 'start' | 'message' | 'user';

interface TicketRef {
  source: TicketSourceId;
  key: string;
}

export async function chatTicketStates(
  db: Queryable,
  conversationId: string,
): Promise<Map<string, ChatTicketState>> {
  const { rows } = await db.query<{ source: TicketSourceId; ticket_key: string; state: string }>(
    `SELECT source, ticket_key, state, 0 AS rank FROM conversation_tickets
     WHERE conversation_id = $1
     UNION ALL
     SELECT tt.source, tt.ticket_key, 'linked', 1 FROM task_tickets tt
     JOIN tasks t ON t.id = tt.task_id
     WHERE t.conversation_id = $1
     ORDER BY rank`,
    [conversationId],
  );
  const states = new Map<string, ChatTicketState>();
  for (const row of rows) {
    const ref = `${row.source}:${row.ticket_key}`;
    if (!states.has(ref)) states.set(ref, row.state as ChatTicketState);
  }
  return states;
}

export async function saveChatTicket(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  ticket: TicketRef,
  state: ChatTicketState,
  linkedBy: ChatTicketLinkedBy,
): Promise<void> {
  await db.query(
    `INSERT INTO conversation_tickets (conversation_id, workspace_id, source, ticket_key, state,
       linked_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (conversation_id, source, ticket_key)
       DO UPDATE SET state = EXCLUDED.state, linked_by = EXCLUDED.linked_by, updated_at = now()`,
    [conversationId, workspaceId, ticket.source, ticket.key, state, linkedBy],
  );
  if (state === 'linked') await linkLatestTask(db, workspaceId, conversationId, ticket);
  if (state === 'unlinked') await unlinkTasks(db, conversationId, ticket);
}

async function linkLatestTask(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  ticket: TicketRef,
): Promise<void> {
  await db.query(
    `INSERT INTO task_tickets (task_id, workspace_id, source, ticket_key)
     SELECT id, $2, $3, $4 FROM tasks WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1
     ON CONFLICT DO NOTHING`,
    [conversationId, workspaceId, ticket.source, ticket.key],
  );
}

async function unlinkTasks(db: Queryable, conversationId: string, ticket: TicketRef) {
  await db.query(
    `DELETE FROM task_tickets tt USING tasks t
     WHERE t.id = tt.task_id AND t.conversation_id = $1 AND tt.source = $2
       AND tt.ticket_key = $3`,
    [conversationId, ticket.source, ticket.key],
  );
}

export async function dismissChatSuggestions(db: Queryable, conversationId: string): Promise<void> {
  await db.query(
    `UPDATE conversation_tickets SET state = 'unlinked', updated_at = now()
     WHERE conversation_id = $1 AND state = 'suggested'`,
    [conversationId],
  );
}

export async function linkTaskToChatTickets(
  db: Queryable,
  taskId: string,
  conversationId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO task_tickets (task_id, workspace_id, source, ticket_key)
     SELECT $1, workspace_id, source, ticket_key FROM conversation_tickets
     WHERE conversation_id = $2 AND state = 'linked'
     ON CONFLICT DO NOTHING`,
    [taskId, conversationId],
  );
}

interface ChatTicketRow {
  source: TicketSourceId;
  key: string;
  title: string;
  url: string;
  status: TicketStatus;
  status_name: string;
  state: 'linked' | 'suggested';
}

const toChatTicket = (row: ChatTicketRow): ChatTicket => ({
  source: row.source,
  key: row.key,
  title: row.title,
  url: row.url,
  status: row.status,
  statusName: row.status_name,
});

export async function chatTickets(
  db: Queryable,
  conversationId: string,
): Promise<Pick<ChatTickets, 'linked' | 'suggested'>> {
  const { rows } = await db.query<ChatTicketRow>(
    `WITH refs AS (
       SELECT source, ticket_key, state, created_at FROM conversation_tickets
       WHERE conversation_id = $1 AND state IN ('linked', 'suggested')
       UNION ALL
       SELECT tt.source, tt.ticket_key, 'linked', tt.created_at FROM task_tickets tt
       JOIN tasks t ON t.id = tt.task_id
       WHERE t.conversation_id = $1
         AND NOT EXISTS (SELECT 1 FROM conversation_tickets ct WHERE ct.conversation_id = $1
           AND ct.source = tt.source AND ct.ticket_key = tt.ticket_key)
     ), first AS (
       SELECT DISTINCT ON (source, ticket_key) source, ticket_key, state, created_at FROM refs
       ORDER BY source, ticket_key, created_at
     )
     SELECT tk.source, tk.key, tk.title, tk.url, tk.status, tk.status_name, f.state
     FROM first f
     JOIN conversations c ON c.id = $1
     JOIN tickets tk ON tk.workspace_id = c.workspace_id AND tk.source = f.source
       AND tk.key = f.ticket_key
     ORDER BY f.created_at, tk.key`,
    [conversationId],
  );
  return {
    linked: rows.filter((row) => row.state === 'linked').map(toChatTicket),
    suggested: rows.filter((row) => row.state === 'suggested').map(toChatTicket),
  };
}

export async function linkedChatTicketKeys(
  db: Queryable,
  conversationId: string,
): Promise<string[]> {
  const states = await chatTicketStates(db, conversationId);
  return [...states]
    .filter(([, state]) => state === 'linked')
    .map(([ref]) => ref.slice(ref.indexOf(':') + 1));
}
