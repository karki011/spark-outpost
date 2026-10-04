import {
  slackSettingsSchema,
  type SlackAllowedChannel,
  type SlackDm,
  type SlackPlaceKind,
  type SlackSettings,
} from '@spark-outpost/contracts';
import { redactText, redactValue } from '../audit/redact.ts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface SlackConnectionRow {
  teamId: string;
  teamName: string;
  teamUrl: string;
  botUserId: string;
  botName: string;
  memberId: string | null;
  memberName: string | null;
  settings: SlackSettings;
  userScopes: string[] | null;
  problem: string | null;
  problemAt: Date | null;
  validatedAt: Date;
}

interface StoredSlackConnection {
  team_id: string;
  team_name: string;
  team_url: string;
  bot_user_id: string;
  bot_name: string;
  member_id: string | null;
  member_name: string | null;
  settings: unknown;
  user_scopes: string[] | null;
  problem: string | null;
  problem_at: Date | null;
  validated_at: Date;
}

export const DEFAULT_SLACK_SETTINGS: SlackSettings = slackSettingsSchema.parse({});

function toConnection(row: StoredSlackConnection): SlackConnectionRow {
  const settings = slackSettingsSchema.safeParse(row.settings);
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    teamUrl: row.team_url,
    botUserId: row.bot_user_id,
    botName: row.bot_name,
    memberId: row.member_id,
    memberName: row.member_name,
    settings: settings.success ? settings.data : DEFAULT_SLACK_SETTINGS,
    userScopes: row.user_scopes,
    problem: row.problem,
    problemAt: row.problem_at,
    validatedAt: row.validated_at,
  };
}

export async function getSlackConnection(
  db: Queryable,
  workspaceId: string,
): Promise<SlackConnectionRow | null> {
  const { rows } = await db.query<StoredSlackConnection>(
    'SELECT * FROM slack_connections WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0] ? toConnection(rows[0]) : null;
}

export interface SlackIdentity {
  teamId: string;
  teamName: string;
  teamUrl: string;
  botUserId: string;
  botName: string;
  member: { id: string; name: string } | null;
  userScopes: string[] | null;
}

export async function saveSlackConnection(
  db: Queryable,
  workspaceId: string,
  identity: SlackIdentity,
): Promise<void> {
  await db.query(
    `INSERT INTO slack_connections
       (workspace_id, team_id, team_name, team_url, bot_user_id, bot_name, member_id, member_name,
        user_scopes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id) DO UPDATE SET
       team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name, team_url = EXCLUDED.team_url,
       bot_user_id = EXCLUDED.bot_user_id, bot_name = EXCLUDED.bot_name,
       member_id = COALESCE(EXCLUDED.member_id, slack_connections.member_id),
       member_name = COALESCE(EXCLUDED.member_name, slack_connections.member_name),
       user_scopes = EXCLUDED.user_scopes,
       problem = NULL, problem_at = NULL, validated_at = now()`,
    [
      workspaceId,
      identity.teamId,
      identity.teamName,
      identity.teamUrl,
      identity.botUserId,
      identity.botName,
      identity.member?.id ?? null,
      identity.member?.name ?? null,
      identity.userScopes,
    ],
  );
}

export async function saveSlackUserScopes(
  db: Queryable,
  workspaceId: string,
  scopes: string[] | null,
): Promise<void> {
  await db.query('UPDATE slack_connections SET user_scopes = $2 WHERE workspace_id = $1', [
    workspaceId,
    scopes,
  ]);
}

export async function deleteSlackConnection(db: Queryable, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM slack_channels WHERE workspace_id = $1', [workspaceId]);
  await db.query('DELETE FROM slack_direct_conversations WHERE workspace_id = $1', [workspaceId]);
  await db.query('DELETE FROM slack_chat_threads WHERE workspace_id = $1', [workspaceId]);
  await db.query('DELETE FROM slack_connections WHERE workspace_id = $1', [workspaceId]);
}

export async function saveSlackSettings(
  db: Queryable,
  workspaceId: string,
  settings: SlackSettings,
): Promise<void> {
  await db.query('UPDATE slack_connections SET settings = $2 WHERE workspace_id = $1', [
    workspaceId,
    JSON.stringify(settings),
  ]);
}

export async function saveSlackMember(
  db: Queryable,
  workspaceId: string,
  member: { id: string; name: string } | null,
): Promise<void> {
  await db.query(
    'UPDATE slack_connections SET member_id = $2, member_name = $3 WHERE workspace_id = $1',
    [workspaceId, member?.id ?? null, member?.name ?? null],
  );
}

export async function setSlackProblem(
  db: Queryable,
  workspaceId: string,
  problem: string | null,
): Promise<void> {
  await db.query(
    `UPDATE slack_connections SET problem = $2, problem_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
     WHERE workspace_id = $1`,
    [workspaceId, problem === null ? null : redactText(problem).slice(0, 300)],
  );
}

interface StoredChannel {
  channel_id: string;
  name: string;
  is_private: boolean;
  project_id: string | null;
}

const toChannel = (row: StoredChannel): SlackAllowedChannel => ({
  id: row.channel_id,
  name: row.name,
  isPrivate: row.is_private,
  projectId: row.project_id,
});

export async function allowedSlackChannels(
  db: Queryable,
  workspaceId: string,
): Promise<SlackAllowedChannel[]> {
  const { rows } = await db.query<StoredChannel>(
    'SELECT channel_id, name, is_private, project_id FROM slack_channels WHERE workspace_id = $1 ORDER BY name',
    [workspaceId],
  );
  return rows.map(toChannel);
}

export async function allowedSlackChannel(
  db: Queryable,
  workspaceId: string,
  channelId: string,
): Promise<SlackAllowedChannel | null> {
  const { rows } = await db.query<StoredChannel>(
    'SELECT channel_id, name, is_private, project_id FROM slack_channels WHERE workspace_id = $1 AND channel_id = $2',
    [workspaceId, channelId],
  );
  return rows[0] ? toChannel(rows[0]) : null;
}

export async function replaceAllowedSlackChannels(
  db: Queryable,
  workspaceId: string,
  channels: readonly SlackAllowedChannel[],
): Promise<void> {
  await db.query(
    'DELETE FROM slack_channels WHERE workspace_id = $1 AND NOT (channel_id = ANY($2::text[]))',
    [workspaceId, channels.map((channel) => channel.id)],
  );
  for (const channel of channels) {
    await db.query(
      `INSERT INTO slack_channels (workspace_id, channel_id, name, is_private, project_id)
       VALUES ($1, $2, $3, $4, (SELECT id FROM projects WHERE id = $5 AND workspace_id = $1))
       ON CONFLICT (workspace_id, channel_id) DO UPDATE SET
         name = EXCLUDED.name, is_private = EXCLUDED.is_private, project_id = EXCLUDED.project_id`,
      [workspaceId, channel.id, channel.name, channel.isPrivate, channel.projectId],
    );
  }
}

interface StoredDm {
  channel_id: string;
  kind: SlackDm['kind'];
  name: string;
}

const toDm = (row: StoredDm): SlackDm => ({ id: row.channel_id, kind: row.kind, name: row.name });

export async function allowedSlackDms(db: Queryable, workspaceId: string): Promise<SlackDm[]> {
  const { rows } = await db.query<StoredDm>(
    'SELECT channel_id, kind, name FROM slack_direct_conversations WHERE workspace_id = $1 ORDER BY name',
    [workspaceId],
  );
  return rows.map(toDm);
}

export async function allowedSlackDm(
  db: Queryable,
  workspaceId: string,
  channelId: string,
): Promise<SlackDm | null> {
  const { rows } = await db.query<StoredDm>(
    'SELECT channel_id, kind, name FROM slack_direct_conversations WHERE workspace_id = $1 AND channel_id = $2',
    [workspaceId, channelId],
  );
  return rows[0] ? toDm(rows[0]) : null;
}

export async function replaceAllowedSlackDms(
  db: Queryable,
  workspaceId: string,
  conversations: readonly SlackDm[],
): Promise<void> {
  await db.query(
    'DELETE FROM slack_direct_conversations WHERE workspace_id = $1 AND NOT (channel_id = ANY($2::text[]))',
    [workspaceId, conversations.map((conversation) => conversation.id)],
  );
  for (const conversation of conversations) {
    await db.query(
      `INSERT INTO slack_direct_conversations (workspace_id, channel_id, kind, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, channel_id) DO UPDATE SET
         kind = EXCLUDED.kind, name = EXCLUDED.name`,
      [workspaceId, conversation.id, conversation.kind, conversation.name],
    );
  }
}

export type SlackEventAction =
  | 'connect'
  | 'disconnect'
  | 'settings'
  | 'channels'
  | 'direct_messages'
  | 'read'
  | 'search'
  | 'post'
  | 'start';

export interface SlackEvent {
  action: SlackEventAction;
  outcome: 'succeeded' | 'skipped' | 'failed';
  channelId?: string | null;
  conversationId?: string | null;
  detail?: Record<string, unknown>;
}

export async function recordSlackEvent(
  db: Queryable,
  workspaceId: string,
  event: SlackEvent,
): Promise<void> {
  await db.query(
    `INSERT INTO slack_events (id, workspace_id, action, outcome, channel_id, conversation_id, detail)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM conversations WHERE id = $6), $7)`,
    [
      newId(),
      workspaceId,
      event.action,
      event.outcome,
      event.channelId ?? null,
      event.conversationId ?? null,
      JSON.stringify(redactValue(event.detail ?? {})),
    ],
  );
}

export async function claimSlackDelivery(
  db: Queryable,
  workspaceId: string,
  claim: { key: string; kind: string; conversationId: string | null },
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO slack_deliveries (id, workspace_id, dedupe_key, kind, conversation_id, outcome)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (workspace_id, dedupe_key) DO NOTHING RETURNING id`,
    [newId(), workspaceId, claim.key, claim.kind, claim.conversationId],
  );
  return rows[0]?.id ?? null;
}

export async function settleSlackDeliveries(
  db: Queryable,
  ids: readonly string[],
  outcome: 'sent' | 'skipped' | 'failed',
  reason: string | null = null,
): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    'UPDATE slack_deliveries SET outcome = $2, reason = $3 WHERE id = ANY($1::uuid[])',
    [ids, outcome, reason === null ? null : redactText(reason).slice(0, 300)],
  );
}

export interface SlackThreadRef {
  channelId: string;
  threadTs: string;
  permalink: string;
}

export interface SlackChatThread extends SlackThreadRef {
  postUpdates: boolean;
}

export async function saveSlackChatThread(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  thread: SlackChatThread,
): Promise<void> {
  await db.query(
    `INSERT INTO slack_chat_threads
       (conversation_id, workspace_id, channel_id, thread_ts, permalink, post_updates)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (conversation_id) DO NOTHING`,
    [
      conversationId,
      workspaceId,
      thread.channelId,
      thread.threadTs,
      thread.permalink,
      thread.postUpdates,
    ],
  );
}

export async function slackChatThread(
  db: Queryable,
  conversationId: string,
): Promise<SlackChatThread | null> {
  const { rows } = await db.query<{
    channel_id: string;
    thread_ts: string;
    permalink: string;
    post_updates: boolean;
  }>(
    'SELECT channel_id, thread_ts, permalink, post_updates FROM slack_chat_threads WHERE conversation_id = $1',
    [conversationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    permalink: row.permalink,
    postUpdates: row.post_updates,
  };
}

export async function saveSlackContextItem(
  db: Queryable,
  attachmentId: string,
  thread: SlackThreadRef & { kind: SlackPlaceKind },
): Promise<void> {
  await db.query(
    `INSERT INTO slack_context_items (attachment_id, channel_id, thread_ts, permalink, kind)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (attachment_id) DO NOTHING`,
    [attachmentId, thread.channelId, thread.threadTs, thread.permalink, thread.kind],
  );
}

export async function markSlackDirectChat(db: Queryable, conversationId: string): Promise<void> {
  await db.query(
    `INSERT INTO slack_direct_chats (conversation_id)
     SELECT id FROM conversations WHERE id = $1 ON CONFLICT (conversation_id) DO NOTHING`,
    [conversationId],
  );
}

export async function conversationReadSlackDms(
  db: Queryable,
  conversationId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM slack_direct_chats WHERE conversation_id = $1)
       OR EXISTS (
         SELECT 1 FROM slack_context_items s
         JOIN attachments a ON a.id = s.attachment_id
         JOIN messages m ON m.id = a.message_id
         WHERE m.conversation_id = $1 AND s.kind <> 'channel'
       ) AS found`,
    [conversationId],
  );
  return rows[0]?.found === true;
}

export async function conversationHasSlackContext(
  db: Queryable,
  conversationId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM slack_context_items s
       JOIN attachments a ON a.id = s.attachment_id
       JOIN messages m ON m.id = a.message_id
       WHERE m.conversation_id = $1
     ) AS found`,
    [conversationId],
  );
  return rows[0]?.found === true;
}

export async function pruneSlackLog(db: Queryable, retentionDays: number): Promise<void> {
  for (const [table, column] of [
    ['slack_deliveries', 'created_at'],
    ['slack_events', 'at'],
  ] as const) {
    await db.query(`DELETE FROM ${table} WHERE ${column} < now() - make_interval(days => $1)`, [
      retentionDays,
    ]);
  }
}
