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
  contextUsed: number | null;
  contextSize: number | null;
  compactSnoozed: boolean;
  model: string | null;
  agentMode: string | null;
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
  context_used: number | null;
  context_size: number | null;
  compact_snoozed: boolean;
  model: string | null;
  agent_mode: string | null;
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
    contextUsed: row.context_used,
    contextSize: row.context_size,
    compactSnoozed: row.compact_snoozed,
    model: row.model,
    agentMode: row.agent_mode,
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

export interface ContextReading {
  used: number;
  size: number;
}

export async function finishProviderSession(
  db: Queryable,
  id: string,
  finished: {
    lastMessageId: string | null;
    replyHash: string;
    context?: ContextReading | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE provider_sessions SET last_message_id = $2, last_reply_hash = $3,
            last_used_at = now(),
            context_used = COALESCE($4, context_used), context_size = COALESCE($5, context_size)
     WHERE id = $1 AND closed_at IS NULL`,
    [
      id,
      finished.lastMessageId,
      finished.replyHash,
      finished.context?.used ?? null,
      finished.context?.size ?? null,
    ],
  );
}

export async function openChatSessions(
  db: Queryable,
  conversationId: string,
): Promise<ProviderSessionRecord[]> {
  const { rows } = await db.query<SessionRow>(
    `SELECT s.*, m.content AS last_message_content
     FROM provider_sessions s
     LEFT JOIN messages m ON m.id = s.last_message_id
     WHERE s.conversation_id = $1 AND starts_with(s.agent_key, 'chat:') AND s.closed_at IS NULL
     ORDER BY s.last_used_at DESC, s.created_at DESC`,
    [conversationId],
  );
  return rows.map(toRecord);
}

export async function recordCompacted(
  db: Queryable,
  id: string,
  context: ContextReading,
): Promise<void> {
  await db.query(
    `UPDATE provider_sessions SET context_used = $2, context_size = $3, compact_snoozed = false,
            last_used_at = now()
     WHERE id = $1 AND closed_at IS NULL`,
    [id, context.used, context.size],
  );
}

export async function snoozeCompaction(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE provider_sessions SET compact_snoozed = true WHERE id = $1', [id]);
}

export async function recordReportedCost(
  db: Queryable,
  id: string,
  reportedCostUsd: number,
): Promise<void> {
  await db.query('UPDATE provider_sessions SET reported_cost_usd = $2 WHERE id = $1', [
    id,
    reportedCostUsd,
  ]);
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
  orchestrationDone: 'orchestration finished',
  compacted: 'compacted',
  movedToFreshChat: 'moved to a fresh chat',
} as const;

export interface SweepLimits {
  idleMs: number;
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
  return (idle.rowCount ?? 0) + (archived.rowCount ?? 0);
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
