import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface ProviderSessionRecord {
  id: string;
  conversationId: string;
  provider: string;
  agentKey: string;
  sessionId: string;
  cwd: string;
  workdir: string | null;
  additionalDirs: string[];
  settingsHash: string;
  lastMessageId: string | null;
  lastReplyHash: string | null;
  lastMessageContent: string | null;
  reportedCostUsd: number | null;
  createdAt: Date;
  lastUsedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
}

interface SessionRow {
  id: string;
  conversation_id: string;
  provider: string;
  agent_key: string;
  session_id: string;
  cwd: string;
  workdir: string | null;
  additional_dirs: string[];
  settings_hash: string;
  last_message_id: string | null;
  last_reply_hash: string | null;
  last_message_content: string | null;
  reported_cost_usd: string | null;
  created_at: Date;
  last_used_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
}

function toRecord(row: SessionRow): ProviderSessionRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    provider: row.provider,
    agentKey: row.agent_key,
    sessionId: row.session_id,
    cwd: row.cwd,
    workdir: row.workdir,
    additionalDirs: row.additional_dirs,
    settingsHash: row.settings_hash,
    lastMessageId: row.last_message_id,
    lastReplyHash: row.last_reply_hash,
    lastMessageContent: row.last_message_content,
    reportedCostUsd: row.reported_cost_usd === null ? null : Number(row.reported_cost_usd),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
  };
}

export async function latestProviderSession(
  db: Queryable,
  conversationId: string,
  agentKey: string,
): Promise<ProviderSessionRecord | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT s.*, m.content AS last_message_content
     FROM provider_sessions s
     LEFT JOIN messages m ON m.id = s.last_message_id
     WHERE s.conversation_id = $1 AND s.agent_key = $2
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 1`,
    [conversationId, agentKey],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export interface SessionStart {
  conversationId: string;
  provider: string;
  agentKey: string;
  sessionId: string;
  cwd: string;
  workdir: string | null;
  additionalDirs: readonly string[];
  settingsHash: string;
  replacedReason: string;
}

export async function startProviderSession(db: Db, start: SessionStart): Promise<string | null> {
  return withTransaction(db, async (client) => {
    const conversation = await client.query(
      'SELECT 1 FROM conversations WHERE id = $1 FOR KEY SHARE',
      [start.conversationId],
    );
    if (!conversation.rowCount) return null;
    const { rows } = await client.query<{ id: string }>(
      `UPDATE provider_sessions SET last_used_at = now(), last_message_id = NULL,
              last_reply_hash = NULL
       WHERE conversation_id = $1 AND agent_key = $2 AND session_id = $3
         AND settings_hash = $4 AND closed_at IS NULL
       RETURNING id`,
      [start.conversationId, start.agentKey, start.sessionId, start.settingsHash],
    );
    if (rows[0]) return rows[0].id;
    await client.query(
      `UPDATE provider_sessions SET closed_at = now(), close_reason = $3
       WHERE conversation_id = $1 AND agent_key = $2 AND closed_at IS NULL`,
      [start.conversationId, start.agentKey, start.replacedReason],
    );
    const id = newId();
    await client.query(
      `INSERT INTO provider_sessions
         (id, conversation_id, provider, agent_key, session_id, cwd, workdir, additional_dirs,
          settings_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        start.conversationId,
        start.provider,
        start.agentKey,
        start.sessionId,
        start.cwd,
        start.workdir,
        [...start.additionalDirs],
        start.settingsHash,
      ],
    );
    return id;
  });
}

export async function finishProviderSession(
  db: Queryable,
  id: string,
  finished: { lastMessageId: string | null; replyHash: string; reportedCostUsd: number | null },
): Promise<void> {
  await db.query(
    `UPDATE provider_sessions SET last_message_id = $2, last_reply_hash = $3,
            reported_cost_usd = $4, last_used_at = now()
     WHERE id = $1 AND closed_at IS NULL`,
    [id, finished.lastMessageId, finished.replyHash, finished.reportedCostUsd],
  );
}

export async function closeProviderSession(
  db: Queryable,
  id: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE provider_sessions SET closed_at = now(), close_reason = $2
     WHERE id = $1 AND closed_at IS NULL`,
    [id, reason],
  );
}

export async function closeConversationSessions(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  reason: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE provider_sessions s SET closed_at = now(), close_reason = $3
     FROM conversations c
     WHERE c.id = s.conversation_id AND c.workspace_id = $1 AND s.conversation_id = $2
       AND s.closed_at IS NULL`,
    [workspaceId, conversationId, reason],
  );
  return rowCount ?? 0;
}

export const SESSION_CLOSE_REASONS = {
  settings: 'settings changed',
  repos: 'repos changed',
  fresh: 'started fresh',
  idle: 'idle',
  archived: 'chat archived',
  evicted: 'too many open sessions',
  orchestrationDone: 'orchestration finished',
} as const;

export interface SweepLimits {
  idleMs: number;
  openLimit: number;
}

export async function sweepProviderSessions(db: Queryable, limits: SweepLimits): Promise<number> {
  const idle = await db.query(
    `UPDATE provider_sessions SET closed_at = now(), close_reason = $2
     WHERE closed_at IS NULL AND last_used_at < now() - make_interval(secs => $1::double precision)`,
    [limits.idleMs / 1000, SESSION_CLOSE_REASONS.idle],
  );
  const archived = await db.query(
    `UPDATE provider_sessions s SET closed_at = now(), close_reason = $1
     FROM conversations c
     WHERE c.id = s.conversation_id AND c.archived_at IS NOT NULL AND s.closed_at IS NULL`,
    [SESSION_CLOSE_REASONS.archived],
  );
  const evicted = await evictBeyondLimit(db, limits.openLimit);
  return (idle.rowCount ?? 0) + (archived.rowCount ?? 0) + evicted;
}

export async function evictBeyondLimit(db: Queryable, openLimit: number): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE provider_sessions SET closed_at = now(), close_reason = $2
     WHERE id IN (
       SELECT id FROM provider_sessions WHERE closed_at IS NULL
       ORDER BY last_used_at DESC, created_at DESC OFFSET $1
     )`,
    [openLimit, SESSION_CLOSE_REASONS.evicted],
  );
  return rowCount ?? 0;
}

export async function idleWorkdirs(db: Queryable, idleMs: number): Promise<string[]> {
  const { rows } = await db.query<{ workdir: string }>(
    `SELECT workdir FROM provider_sessions WHERE workdir IS NOT NULL
     GROUP BY workdir
     HAVING bool_and(closed_at IS NOT NULL)
        AND max(last_used_at) < now() - make_interval(secs => $1::double precision)`,
    [idleMs / 1000],
  );
  return rows.map((row) => row.workdir);
}

export async function forgetWorkdir(db: Queryable, workdir: string): Promise<void> {
  await db.query(
    'UPDATE provider_sessions SET workdir = NULL WHERE workdir = $1 AND closed_at IS NOT NULL',
    [workdir],
  );
}

export async function conversationWorkdirs(
  db: Queryable,
  conversationId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ workdir: string }>(
    `SELECT DISTINCT workdir FROM provider_sessions
     WHERE conversation_id = $1 AND workdir IS NOT NULL`,
    [conversationId],
  );
  return rows.map((row) => row.workdir);
}

export async function closeKeyedSessions(
  db: Queryable,
  conversationId: string,
  keyPrefix: string,
  reason: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE provider_sessions SET closed_at = now(), close_reason = $3
     WHERE conversation_id = $1 AND starts_with(agent_key, $2) AND closed_at IS NULL`,
    [conversationId, keyPrefix, reason],
  );
  return rowCount ?? 0;
}
