import {
  digestBodySchema,
  digestStatsSchema,
  planBodySchema,
  type ConversationSummary,
  type Digest,
  type DigestBody,
  type DigestStats,
  type DigestStatus,
} from '@spark-outpost/contracts';
import type { ActivityChat, ChatState } from '../digest/input.ts';
import { flaggedItemSchema, type FlaggedItem } from './attention-settings.ts';
import type { LastDigest } from '../digest/policy.ts';
import { EMPTY_DIGEST_STATS } from '../digest/stats.ts';
import { listConversations } from './conversations.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';

const STALE_RUNNING_MS = 10 * 60_000;
const UNFINISHED_AFTER_RUN_MS = 60_000;
const STALE_MESSAGE = 'The digest did not finish. Try again.';

interface DigestRow {
  id: string;
  status: DigestStatus;
  created_at: Date;
  finished_at: Date | null;
  since: Date;
  body: unknown;
  error: string | null;
  provider: string;
  model_label: string | null;
  conversation_id: string | null;
  run_status: string | null;
  run_finished_at: Date | null;
  cost_usd: string | null;
  cost_source: 'reported' | 'estimated' | null;
  stats: unknown;
}

function effectiveStatus(
  row: DigestRow,
  now: Date,
): { status: DigestStatus; error: string | null } {
  if (row.status !== 'running') return { status: row.status, error: row.error };
  const runEnded =
    row.run_status !== null && ['failed', 'cancelled', 'outcome_unknown'].includes(row.run_status);
  const runEndedAt = row.run_finished_at ?? row.created_at;
  const abandoned = runEnded && now.getTime() - runEndedAt.getTime() > UNFINISHED_AFTER_RUN_MS;
  const stale = now.getTime() - row.created_at.getTime() > STALE_RUNNING_MS;
  return abandoned || stale
    ? { status: 'failed', error: STALE_MESSAGE }
    : { status: 'running', error: null };
}

function toDigest(row: DigestRow, now: Date): Digest {
  const { status, error } = effectiveStatus(row, now);
  const body = digestBodySchema.safeParse(row.body);
  const stats = digestStatsSchema.safeParse(row.stats);
  return {
    id: row.id,
    status,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    since: row.since.toISOString(),
    body: body.success ? body.data : null,
    error,
    provider: row.provider,
    modelLabel: row.model_label,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    costSource: row.cost_usd === null ? null : (row.cost_source ?? 'reported'),
    conversationId: row.conversation_id,
    stats: stats.success ? stats.data : EMPTY_DIGEST_STATS,
  };
}

export async function latestDigests(
  db: Queryable,
  workspaceId: string,
  now: Date = new Date(),
): Promise<{ latest: Digest | null; lastReady: Digest | null }> {
  const { rows } = await db.query<DigestRow>(
    `SELECT d.id, d.status, d.created_at, d.finished_at, d.since, d.body, d.error, d.provider,
       d.model_label, d.conversation_id, d.stats, r.status AS run_status,
       r.finished_at AS run_finished_at, r.cost_usd, r.cost_source
     FROM digests d LEFT JOIN runs r ON r.id = d.run_id
     WHERE d.workspace_id = $1
     ORDER BY d.created_at DESC LIMIT 20`,
    [workspaceId],
  );
  const digests = rows.map((row) => toDigest(row, now));
  return {
    latest: digests[0] ?? null,
    lastReady: digests.find((digest) => digest.status === 'ready') ?? null,
  };
}

export function asLast(digest: Digest | null): LastDigest | null {
  return digest ? { status: digest.status, createdAt: new Date(digest.createdAt) } : null;
}

export async function hasActivitySince(
  db: Queryable,
  workspaceId: string,
  since: Date,
): Promise<boolean> {
  const { rows } = await db.query<{ active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs r JOIN conversations c ON c.id = r.conversation_id
       WHERE c.workspace_id = $1 AND c.kind = 'chat'
         AND (r.created_at >= $2 OR r.finished_at >= $2)
     ) AS active`,
    [workspaceId, since],
  );
  return rows[0]?.active ?? false;
}

interface ExtraRow {
  id: string;
  last_reply: string | null;
  files_changed: number;
  reverted: boolean;
  checks: string | null;
  plan: unknown;
  cost_usd: number | null;
  project: string | null;
}

async function activeIds(db: Queryable, workspaceId: string, since: Date): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT DISTINCT c.id FROM conversations c JOIN runs r ON r.conversation_id = c.id
     WHERE c.workspace_id = $1 AND c.kind = 'chat' AND c.archived_at IS NULL
       AND (r.created_at >= $2 OR r.finished_at >= $2)`,
    [workspaceId, since],
  );
  return new Set(rows.map((row) => row.id));
}

async function extras(db: Queryable, ids: readonly string[], since: Date): Promise<ExtraRow[]> {
  const { rows } = await db.query<ExtraRow>(
    `SELECT c.id,
       (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant'
        ORDER BY m.created_at DESC LIMIT 1) AS last_reply,
       (SELECT count(DISTINCT b.path) FROM run_file_backups b JOIN runs r ON r.id = b.run_id
        WHERE r.conversation_id = c.id AND r.created_at >= $2)::int AS files_changed,
       EXISTS (SELECT 1 FROM runs r WHERE r.conversation_id = c.id AND r.reverted_at >= $2)
         AS reverted,
       (SELECT a.body->>'status' FROM run_artifacts a JOIN tasks t ON t.id = a.task_id
        WHERE t.conversation_id = c.id AND a.kind = 'check'
        ORDER BY a.created_at DESC LIMIT 1) AS checks,
       (SELECT a.body FROM run_artifacts a JOIN tasks t ON t.id = a.task_id
        WHERE t.conversation_id = c.id AND a.kind = 'plan'
        ORDER BY a.created_at DESC, a.version DESC LIMIT 1) AS plan,
       (SELECT sum(r.cost_usd)::float8 FROM runs r
        WHERE r.conversation_id = c.id AND r.created_at >= $2) AS cost_usd,
       (SELECT p.name FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
        WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at LIMIT 1) AS project
     FROM conversations c WHERE c.id = ANY($1::uuid[])`,
    [ids, since],
  );
  return rows;
}

function chatState(chat: ConversationSummary): ChatState {
  if (chat.needsInput) return 'waiting';
  switch (chat.latestRun?.status) {
    case 'queued':
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'outcome_unknown':
      return 'stalled';
    case 'succeeded':
      return 'finished';
    default:
      return 'idle';
  }
}

function planOf(value: unknown): ActivityChat['plan'] {
  const plan = planBodySchema.safeParse(value);
  if (!plan.success || plan.data.entries.length === 0) return null;
  const entries = plan.data.entries;
  return {
    done: entries.filter((entry) => entry.status === 'completed').length,
    total: entries.length,
    open: entries.filter((entry) => entry.status !== 'completed').map((entry) => entry.content),
  };
}

function checksOf(value: string | null): ActivityChat['checks'] {
  return value === 'passed' || value === 'failed' ? value : null;
}

export async function loadActivity(
  db: Queryable,
  workspaceId: string,
  since: Date,
): Promise<ActivityChat[]> {
  const ids = await activeIds(db, workspaceId, since);
  if (ids.size === 0) return [];
  const summaries = (await listConversations(db, workspaceId)).filter((chat) => ids.has(chat.id));
  const extra = new Map((await extras(db, [...ids], since)).map((row) => [row.id, row] as const));
  return summaries.map((chat): ActivityChat => {
    const row = extra.get(chat.id);
    const attention = chat.attention;
    return {
      id: chat.id,
      title: chat.title,
      project: row?.project ?? null,
      category: chat.category,
      updatedAt: chat.updatedAt,
      state: chatState(chat),
      waitingOn: attention ? `${attention.kind}: ${attention.title}` : null,
      error: chat.latestRun?.error ?? null,
      plan: planOf(row?.plan),
      filesChanged: row?.files_changed ?? 0,
      reverted: row?.reverted ?? false,
      checks: checksOf(row?.checks ?? null),
      lastReply: row?.last_reply ?? null,
      costUsd: row?.cost_usd ?? null,
    };
  });
}

export interface NewDigest {
  provider: string;
  model: string | null;
  modelLabel: string | null;
  effort: string | null;
  since: Date;
  until: Date;
  prompt: string;
  chatIds: readonly string[];
  stats: DigestStats;
  flagged: readonly FlaggedItem[];
  flaggedHash: string;
}

export async function startDigest(
  db: Db,
  workspaceId: string,
  digest: NewDigest,
  minGapMs: number,
): Promise<string | null> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`digest:${workspaceId}`]);
    const recent = await client.query(
      `SELECT 1 FROM digests
       WHERE workspace_id = $1 AND created_at > now() - make_interval(secs => $2)`,
      [workspaceId, minGapMs / 1000],
    );
    if (recent.rowCount) return null;
    const conversationId = newId();
    const messageId = newId();
    const runId = newId();
    const digestId = newId();
    await client.query(
      `INSERT INTO conversations (id, workspace_id, title, kind, title_source)
       VALUES ($1, $2, 'Digest', 'digest', 'user')`,
      [conversationId, workspaceId],
    );
    await client.query(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [messageId, conversationId, digest.prompt],
    );
    await client.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, effort, status,
         mode, role, picked_mode, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', 'chat', 'digest', 'chat', 'digest')`,
      [runId, conversationId, messageId, digest.provider, digest.model, digest.effort],
    );
    await client.query(`INSERT INTO jobs (id, run_id, status) VALUES ($1, $2, 'queued')`, [
      newId(),
      runId,
    ]);
    await client.query(
      `INSERT INTO digests (id, workspace_id, conversation_id, run_id, status, since, until,
         chat_ids, provider, model, model_label, stats, flagged, flagged_hash)
       VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        digestId,
        workspaceId,
        conversationId,
        runId,
        digest.since,
        digest.until,
        digest.chatIds,
        digest.provider,
        digest.model,
        digest.modelLabel,
        JSON.stringify(digest.stats),
        JSON.stringify(digest.flagged),
        digest.flaggedHash,
      ],
    );
    await client.query(`SELECT pg_notify('jobs', $1)`, [runId]);
    return digestId;
  });
}

export async function isDigestRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ role: string | null }>('SELECT role FROM runs WHERE id = $1', [
    runId,
  ]);
  return rows[0]?.role === 'digest';
}

export async function digestChatIds(db: Queryable, runId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ chat_ids: string[] }>(
    'SELECT chat_ids FROM digests WHERE run_id = $1',
    [runId],
  );
  return new Set(rows[0]?.chat_ids ?? []);
}

export async function digestFlaggedByRun(db: Queryable, runId: string): Promise<FlaggedItem[]> {
  const { rows } = await db.query<{ flagged: unknown }>(
    'SELECT flagged FROM digests WHERE run_id = $1',
    [runId],
  );
  const parsed = flaggedItemSchema.array().safeParse(rows[0]?.flagged ?? []);
  return parsed.success ? parsed.data : [];
}

export async function lastFlaggedHash(db: Queryable, workspaceId: string): Promise<string | null> {
  const { rows } = await db.query<{ flagged_hash: string | null }>(
    `SELECT flagged_hash FROM digests WHERE workspace_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId],
  );
  return rows[0]?.flagged_hash ?? null;
}

export async function digestStatsByRun(db: Queryable, runId: string): Promise<DigestStats> {
  const { rows } = await db.query<{ stats: unknown }>(
    'SELECT stats FROM digests WHERE run_id = $1',
    [runId],
  );
  const parsed = digestStatsSchema.safeParse(rows[0]?.stats);
  return parsed.success ? parsed.data : EMPTY_DIGEST_STATS;
}

export async function finishDigest(
  db: Queryable,
  runId: string,
  outcome: { body: DigestBody } | { error: string },
): Promise<void> {
  const ready = 'body' in outcome;
  await db.query(
    `UPDATE digests SET status = $2, body = $3, error = $4, finished_at = now()
     WHERE run_id = $1 AND status = 'running'`,
    [
      runId,
      ready ? 'ready' : 'failed',
      ready ? JSON.stringify(outcome.body) : null,
      ready ? null : outcome.error,
    ],
  );
}
