import {
  attentionItemSchema,
  parseAttentionKey,
  type AttentionItem,
  type AttentionMark,
  type ParsedAttentionKey,
  type ScheduleUpdate,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export class AttentionItemNotFoundError extends Error {
  constructor() {
    super('That item was not found.');
  }
}

interface ItemRow {
  key: string;
  kind: string;
  blocking: boolean;
  conversation_id: string;
  detail: string | null;
  at: Date;
  read_at: Date | null;
  set_aside_at: Date | null;
  dismissed_at: Date | null;
  schedule_workflow_id: string | null;
  schedule_name: string | null;
  runs_today: number | null;
  failed_today: number | null;
}

const SCHEDULED_TODAY = `w.conversation_id = ws.conversation_id AND w.workflow_id = ws.workflow_id
  AND w.source IN ('schedule', 'catch_up') AND w.started_at >= $3`;

const ITEMS = `
  WITH chats AS (
    SELECT c.id, c.seen_at,
      EXISTS (SELECT 1 FROM profiles p WHERE p.assistant_conversation_id = c.id) AS assistant
    FROM conversations c
    WHERE c.workspace_id = $1 AND c.archived_at IS NULL AND ($2::uuid IS NULL OR c.id = $2)
  ), latest AS (
    SELECT ch.id, ch.seen_at, ch.assistant, r.id AS run_id, r.status, r.finished_at, r.error
    FROM chats ch
    LEFT JOIN LATERAL (
      SELECT id, status, finished_at, error FROM runs
      WHERE conversation_id = ch.id AND parent_run_id IS NULL ORDER BY created_at DESC LIMIT 1
    ) r ON true
  ), sched AS (
    SELECT ws.conversation_id, ws.workflow_id,
      (SELECT w.workflow_name FROM workflow_runs w
       WHERE w.workspace_id = ws.workspace_id AND w.workflow_id = ws.workflow_id
       ORDER BY w.started_at DESC LIMIT 1) AS name,
      (SELECT count(*) FROM workflow_runs w WHERE ${SCHEDULED_TODAY})::int AS runs_today,
      (SELECT count(*) FROM workflow_runs w
       WHERE ${SCHEDULED_TODAY} AND w.status = 'failed')::int AS failed_today
    FROM workflow_schedules ws
    WHERE ws.workspace_id = $1 AND ws.conversation_id IS NOT NULL
  ), pending AS (
    SELECT l.id AS conversation_id, l.seen_at, a.id, a.created_at
    FROM latest l
    JOIN runs ar ON ar.id = l.run_id OR ar.parent_run_id = l.run_id
    JOIN approvals a ON a.run_id = ar.id AND a.status = 'pending'
  ), items AS (
    SELECT 'approval:' || p.id AS key, 'approval' AS kind, true AS blocking, p.conversation_id,
      NULL::text AS detail, p.created_at AS at, p.seen_at
    FROM pending p
    UNION ALL
    SELECT 'terminal:' || t.id || ':' || t.generation || ':'
        || floor(extract(epoch FROM t.waiting_since) * 1000)::bigint,
      'terminal', true, l.id, NULL, t.waiting_since, l.seen_at
    FROM latest l JOIN native_terminal_sessions t ON t.conversation_id = l.id
    WHERE t.state IN ('waiting_for_permission', 'waiting_for_input')
      AND t.waiting_since IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pending p WHERE p.conversation_id = l.id)
    UNION ALL
    SELECT 'flag:' || f.id, 'flag', false, l.id, f.title, f.created_at, l.seen_at
    FROM latest l JOIN rail_flags f ON f.conversation_id = l.id AND f.status = 'open'
    UNION ALL
    SELECT 'shell-alert:' || s.id, 'shell-alert', false, l.id, s.message, s.created_at, l.seen_at
    FROM latest l JOIN shell_alerts s ON s.conversation_id = l.id
    UNION ALL
    SELECT 'pr-clean:' || w.id || ':' || w.head_sha, 'pr-clean', false, l.id,
      w.owner || '/' || w.repo || '#' || w.number, w.clean_since, l.seen_at
    FROM latest l JOIN pr_watches w ON w.conversation_id = l.id
    WHERE w.pr_state = 'open' AND w.clean_since IS NOT NULL AND w.head_sha IS NOT NULL
      AND w.clean_head_sha = w.head_sha AND w.head_sha ~ '^[0-9a-f]{7,64}$'
    UNION ALL
    SELECT CASE l.status WHEN 'failed' THEN 'run-failed:' ELSE 'run-done:' END || l.run_id,
      CASE l.status WHEN 'failed' THEN 'run-failed' ELSE 'run-done' END, false, l.id,
      CASE l.status WHEN 'failed' THEN l.error END, l.finished_at, l.seen_at
    FROM latest l
    WHERE l.status IN ('succeeded', 'failed') AND l.finished_at IS NOT NULL AND NOT l.assistant
    UNION ALL
    SELECT 'run-failed:' || r.id, 'run-failed', false, l.id, r.error, r.finished_at, l.seen_at
    FROM latest l
    JOIN workflow_schedules ws ON ws.conversation_id = l.id
    JOIN workflow_runs w ON ${SCHEDULED_TODAY} AND w.status = 'failed'
    JOIN runs r ON r.id = w.run_id
    WHERE r.id <> l.run_id AND r.finished_at IS NOT NULL
  ), marked AS (
    SELECT i.key, i.kind, i.blocking, i.conversation_id, i.detail, i.at,
      COALESCE(m.read_at, CASE WHEN i.seen_at >= i.at THEN i.seen_at END) AS read_at,
      m.set_aside_at, m.dismissed_at,
      s.workflow_id AS schedule_workflow_id, s.name AS schedule_name, s.runs_today, s.failed_today
    FROM items i
    LEFT JOIN attention_marks m ON m.workspace_id = $1 AND m.key = i.key
    LEFT JOIN latest ll ON ll.id = i.conversation_id
    LEFT JOIN sched s ON s.conversation_id = i.conversation_id AND s.name IS NOT NULL
      AND i.key IN ('run-done:' || ll.run_id, 'run-failed:' || ll.run_id)
  )
  SELECT * FROM marked
  WHERE blocking OR (read_at IS NULL AND dismissed_at IS NULL)
  ORDER BY at, key`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function scheduleOf(row: ItemRow): ScheduleUpdate | null {
  if (row.schedule_workflow_id === null || row.schedule_name === null) return null;
  return {
    workflowId: row.schedule_workflow_id,
    name: row.schedule_name,
    runsToday: row.runs_today ?? 0,
    failedToday: row.failed_today ?? 0,
  };
}

function dayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toItem(row: ItemRow): AttentionItem {
  return attentionItemSchema.parse({
    key: row.key,
    kind: row.kind,
    blocking: row.blocking,
    conversationId: row.conversation_id,
    detail: row.detail,
    at: row.at.toISOString(),
    readAt: iso(row.read_at),
    setAsideAt: iso(row.set_aside_at),
    dismissedAt: iso(row.dismissed_at),
    schedule: scheduleOf(row),
  });
}

export async function listAttentionItems(
  db: Queryable,
  workspaceId: string,
  conversationId: string | null = null,
  now: Date = new Date(),
): Promise<AttentionItem[]> {
  const { rows } = await db.query<ItemRow>(ITEMS, [workspaceId, conversationId, dayStart(now)]);
  return rows.map(toItem);
}

const OWNERS: Record<ParsedAttentionKey['kind'], string> = {
  approval: `SELECT r.conversation_id FROM approvals a JOIN runs r ON r.id = a.run_id
    JOIN conversations c ON c.id = r.conversation_id WHERE a.id = $1 AND c.workspace_id = $2`,
  flag: `SELECT f.conversation_id FROM rail_flags f
    JOIN conversations c ON c.id = f.conversation_id WHERE f.id = $1 AND c.workspace_id = $2`,
  'run-done': `SELECT r.conversation_id FROM runs r
    JOIN conversations c ON c.id = r.conversation_id WHERE r.id = $1 AND c.workspace_id = $2`,
  'run-failed': `SELECT r.conversation_id FROM runs r
    JOIN conversations c ON c.id = r.conversation_id WHERE r.id = $1 AND c.workspace_id = $2`,
  'shell-alert': `SELECT s.conversation_id FROM shell_alerts s
    JOIN conversations c ON c.id = s.conversation_id WHERE s.id = $1 AND c.workspace_id = $2`,
  terminal: `SELECT t.conversation_id FROM native_terminal_sessions t
    JOIN conversations c ON c.id = t.conversation_id WHERE t.id = $1 AND c.workspace_id = $2`,
  'pr-clean': `SELECT w.conversation_id FROM pr_watches w
    JOIN conversations c ON c.id = w.conversation_id WHERE w.id = $1 AND c.workspace_id = $2`,
};

async function ownerOf(db: Queryable, workspaceId: string, key: string): Promise<string> {
  const parsed = parseAttentionKey(key);
  if (!parsed) throw new AttentionItemNotFoundError();
  const { rows } = await db.query<{ conversation_id: string }>(OWNERS[parsed.kind], [
    parsed.id,
    workspaceId,
  ]);
  const owner = rows[0]?.conversation_id;
  if (!owner) throw new AttentionItemNotFoundError();
  return owner;
}

export async function notifyAttention(db: Queryable, conversationId: string): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'attention', conversationId, runId: null }),
  ]);
}

export async function markAttention(
  db: Queryable,
  workspaceId: string,
  key: string,
  mark: AttentionMark,
): Promise<string> {
  const conversationId = await ownerOf(db, workspaceId, key);
  await db.query(
    `INSERT INTO attention_marks (workspace_id, key, conversation_id, set_aside_at, dismissed_at)
     VALUES ($1, $2, $3,
       CASE WHEN $4 = 'set-aside' THEN now() END, CASE WHEN $4 = 'dismiss' THEN now() END)
     ON CONFLICT (workspace_id, key) DO UPDATE SET
       set_aside_at = COALESCE(attention_marks.set_aside_at, EXCLUDED.set_aside_at),
       dismissed_at = COALESCE(attention_marks.dismissed_at, EXCLUDED.dismissed_at)`,
    [workspaceId, key, conversationId, mark],
  );
  await notifyAttention(db, conversationId);
  return conversationId;
}

export async function readAttentionKeys(
  db: Queryable,
  workspaceId: string,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { rows } = await db.query<{ key: string }>(
    'SELECT key FROM attention_marks WHERE workspace_id = $1 AND key = ANY($2::text[])',
    [workspaceId, keys],
  );
  return new Set(rows.map((row) => row.key));
}
