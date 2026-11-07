import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export const RECAP_CHAT_LIMIT = 25;
export const RECAP_PR_LIMIT = 30;
export const RECAP_TICKET_LIMIT = 25;

export interface RecapChatRow {
  id: string;
  title: string;
  project: string | null;
  turns: number;
  failed: number;
  kept: number;
  files_changed: number;
  last_reply: string | null;
  waiting_on: string | null;
}

export interface RecapPullRow {
  conversation_id: string;
  owner: string;
  repo: string;
  number: number;
  title: string | null;
  url: string;
  pr_state: 'open' | 'merged' | 'closed';
  draft: boolean;
  checks: 'none' | 'pending' | 'passing' | 'failing';
  review: 'none' | 'approved' | 'changes_requested';
  created_at: Date;
}

export interface RecapTicketRow {
  source: string;
  ticket_key: string;
  title: string | null;
  status: string | null;
  url: string | null;
  conversation_id: string | null;
  actions: string[];
}

export interface RecapRows {
  chats: RecapChatRow[];
  pulls: RecapPullRow[];
  tickets: RecapTicketRow[];
}

const VISIBLE_CHAT = `c.workspace_id = $1 AND c.kind = 'chat' AND c.session_type = 'chat'
  AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.assistant_conversation_id = c.id)`;

async function chatRows(db: Queryable, workspaceId: string, since: Date) {
  const { rows } = await db.query<RecapChatRow>(
    `WITH week AS (
       SELECT c.id, c.title, max(GREATEST(r.created_at, r.finished_at)) AS last_at,
         count(*) FILTER (WHERE r.status = 'succeeded')::int AS turns,
         count(*) FILTER (WHERE r.status = 'failed')::int AS failed
       FROM conversations c JOIN runs r ON r.conversation_id = c.id
       WHERE ${VISIBLE_CHAT} AND r.parent_run_id IS NULL AND r.role IS DISTINCT FROM 'digest'
         AND (r.created_at >= $2 OR r.finished_at >= $2)
       GROUP BY c.id, c.title
       ORDER BY last_at DESC LIMIT $3
     )
     SELECT w.id, w.title, w.turns, w.failed,
       (SELECT p.name FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
        WHERE cp.conversation_id = w.id ORDER BY cp.position, cp.created_at LIMIT 1) AS project,
       (SELECT count(*) FROM approvals a JOIN runs r ON r.id = a.run_id
        WHERE r.conversation_id = w.id AND a.kind = 'accept' AND a.decision_option_id = $4
          AND a.decided_at >= $2)::int AS kept,
       (SELECT count(DISTINCT b.path) FROM run_file_backups b JOIN runs r ON r.id = b.run_id
        WHERE r.conversation_id = w.id AND r.created_at >= $2)::int AS files_changed,
       (SELECT m.content FROM messages m WHERE m.conversation_id = w.id AND m.role = 'assistant'
        ORDER BY m.created_at DESC LIMIT 1) AS last_reply,
       (SELECT a.title FROM approvals a JOIN runs r ON r.id = a.run_id
        WHERE r.conversation_id = w.id AND a.status = 'pending'
        ORDER BY a.created_at LIMIT 1) AS waiting_on
     FROM week w ORDER BY w.last_at DESC`,
    [workspaceId, since, RECAP_CHAT_LIMIT, CHECKPOINT_OPTION.keep],
  );
  return rows;
}

async function pullRows(db: Queryable, workspaceId: string, since: Date) {
  const { rows } = await db.query<RecapPullRow>(
    `SELECT w.conversation_id, w.owner, w.repo, w.number, w.title, w.url, w.pr_state, w.draft,
       w.checks, w.review, w.created_at
     FROM pr_watches w JOIN conversations c ON c.id = w.conversation_id
     WHERE ${VISIBLE_CHAT}
       AND (w.pr_state = 'open' OR (w.pr_state = 'merged' AND w.updated_at >= $2))
     ORDER BY (w.pr_state = 'merged') DESC, w.updated_at DESC LIMIT $3`,
    [workspaceId, since, RECAP_PR_LIMIT],
  );
  return rows;
}

async function ticketRows(db: Queryable, workspaceId: string, since: Date) {
  const { rows } = await db.query<RecapTicketRow>(
    `SELECT e.source, e.ticket_key, t.title, t.status, t.url,
       (array_agg(k.conversation_id ORDER BY e.at DESC)
          FILTER (WHERE k.conversation_id IS NOT NULL))[1] AS conversation_id,
       array_agg(DISTINCT e.action) AS actions
     FROM ticket_events e
     LEFT JOIN tickets t ON t.workspace_id = e.workspace_id AND t.source = e.source
       AND t.key = e.ticket_key
     LEFT JOIN tasks k ON k.id = e.task_id
     WHERE e.workspace_id = $1 AND e.at >= $2 AND e.outcome = 'succeeded'
       AND e.ticket_key IS NOT NULL
       AND e.action IN ('start', 'transition', 'comment', 'link_pr')
     GROUP BY e.source, e.ticket_key, t.title, t.status, t.url
     ORDER BY max(e.at) DESC LIMIT $3`,
    [workspaceId, since, RECAP_TICKET_LIMIT],
  );
  return rows;
}

export async function recapRows(
  db: Queryable,
  workspaceId: string,
  since: Date,
): Promise<RecapRows> {
  const [chats, pulls, tickets] = await Promise.all([
    chatRows(db, workspaceId, since),
    pullRows(db, workspaceId, since),
    ticketRows(db, workspaceId, since),
  ]);
  return { chats, pulls, tickets };
}
