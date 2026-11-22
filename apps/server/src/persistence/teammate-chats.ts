import {
  TEAMMATE_FOLLOWED_FIELDS,
  UNTITLED_CONVERSATION,
  type Teammate,
  type TeammateChat,
  type TeammateTag,
  type UpdateChatSettingsRequest,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import type { StoredSparkBrief } from '../crew/spark-brief.ts';
import { clearChatAgent, updateChatSettings } from './chat-settings.ts';
import { setConversationProjects } from './conversation-projects.ts';
import { createConversation } from './conversations.ts';
import { withTransaction, type Db, type DbClient, type Queryable } from './db.ts';
import { newId } from './ids.ts';
import { SESSION_CLOSE_REASONS } from './provider-sessions.ts';
import { InvalidDefaultError } from './setup.ts';
import { TeammateConflictError, defaultTeammateId, getTeammate } from './teammates.ts';

function defaultsOf(teammate: Teammate): UpdateChatSettingsRequest {
  const update: UpdateChatSettingsRequest = {};
  if (teammate.provider) {
    update.provider = teammate.provider;
    if (teammate.model) update.model = teammate.model;
    if (teammate.effort) update.effort = teammate.effort;
    if (teammate.agentMode) update.agentMode = teammate.agentMode;
  }
  if (teammate.level) update.level = teammate.level;
  return update;
}

async function settleSettings(
  client: Queryable,
  conversationId: string,
  update: UpdateChatSettingsRequest,
): Promise<boolean> {
  if (Object.keys(update).length === 0) return true;
  try {
    await updateChatSettings(client, conversationId, update);
    return true;
  } catch (error) {
    if (error instanceof InvalidDefaultError) return false;
    throw error;
  }
}

async function applyDefaults(client: Queryable, conversationId: string, teammate: Teammate) {
  if (await settleSettings(client, conversationId, defaultsOf(teammate))) return;
  if (teammate.level) await settleSettings(client, conversationId, { level: teammate.level });
}

async function clearChat(client: DbClient, workspaceId: string, conversationId: string) {
  await client.query(
    `UPDATE conversations SET teammate_id = NULL, provider = NULL, overrides = '{}'
     WHERE id = $1`,
    [conversationId],
  );
  await setConversationProjects(client, workspaceId, conversationId, []);
}

async function attach(
  client: DbClient,
  workspaceId: string,
  conversationId: string,
  teammate: Teammate,
) {
  await client.query(
    `UPDATE conversations SET teammate_id = $2, provider = NULL, overrides = '{}'
     WHERE id = $1`,
    [conversationId, teammate.id],
  );
  await applyDefaults(client, conversationId, teammate);
  await setConversationProjects(client, workspaceId, conversationId, teammate.projectIds);
}

async function assertUnstarted(client: Queryable, conversationId: string): Promise<void> {
  const { rows } = await client.query<{ started: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM messages WHERE conversation_id = $1) AS started',
    [conversationId],
  );
  if (rows[0]?.started) {
    throw new TeammateConflictError('Pick a Spark before the first message of a chat.');
  }
}

export async function linkChat(
  db: Db,
  workspaceId: string,
  conversationId: string,
  teammateId: string | null,
): Promise<TeammateChat> {
  return withTransaction(db, async (client) => {
    await createConversation(client, workspaceId, conversationId);
    await assertUnstarted(client, conversationId);
    if (!teammateId) {
      await clearChat(client, workspaceId, conversationId);
      return { conversationId, teammate: null };
    }
    const teammate = await getTeammate(client, workspaceId, teammateId);
    await attach(client, workspaceId, conversationId, teammate);
    const { id, name, role, face } = teammate;
    return { conversationId, teammate: { id, name, role, face } };
  });
}

const tagOf = ({ id, name, role, face }: Teammate): TeammateTag => ({ id, name, role, face });

async function linkedTag(
  client: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<TeammateTag | null> {
  const { rows } = await client.query<{ teammate_id: string | null }>(
    'SELECT teammate_id FROM conversations WHERE id = $1 AND workspace_id = $2',
    [conversationId, workspaceId],
  );
  const id = rows[0]?.teammate_id;
  return id ? tagOf(await getTeammate(client, workspaceId, id)) : null;
}

export async function setDefaultTeammate(
  db: Queryable,
  workspaceId: string,
  teammateId: string | null,
): Promise<void> {
  if (teammateId) await getTeammate(db, workspaceId, teammateId);
  await db.query(
    `INSERT INTO profiles (workspace_id, default_teammate_id) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET default_teammate_id = EXCLUDED.default_teammate_id`,
    [workspaceId, teammateId],
  );
}

export async function startWithDefaultTeammate(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<TeammateChat> {
  return withTransaction(db, async (client) => {
    const teammateId = await defaultTeammateId(client, workspaceId);
    if (!teammateId) {
      return { conversationId, teammate: await linkedTag(client, workspaceId, conversationId) };
    }
    const created = await client.query(
      `INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [conversationId, workspaceId, UNTITLED_CONVERSATION],
    );
    if (created.rowCount !== 1) {
      return { conversationId, teammate: await linkedTag(client, workspaceId, conversationId) };
    }
    const teammate = await getTeammate(client, workspaceId, teammateId);
    await attach(client, workspaceId, conversationId, teammate);
    return { conversationId, teammate: tagOf(teammate) };
  });
}

async function followAgent(
  client: Queryable,
  conversationId: string,
  teammate: Teammate,
): Promise<boolean> {
  if (!teammate.provider) {
    await clearChatAgent(client, conversationId);
    return true;
  }
  return settleSettings(client, conversationId, {
    provider: teammate.provider,
    model: teammate.model,
    effort: teammate.effort,
    agentMode: teammate.agentMode,
  });
}

export async function followTeammateSettings(
  db: Db,
  workspaceId: string,
  teammate: Teammate,
  update: UpdateTeammateRequest,
): Promise<string[]> {
  if (!TEAMMATE_FOLLOWED_FIELDS.some((field) => update[field] !== undefined)) return [];
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT c.id FROM conversations c
       WHERE c.workspace_id = $1 AND c.teammate_id = $2 AND c.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM runs r WHERE r.conversation_id = c.id
             AND r.status IN ('queued', 'running', 'awaiting_approval')
         )
       ORDER BY c.id FOR UPDATE OF c`,
      [workspaceId, teammate.id],
    );
    const followed: string[] = [];
    for (const { id } of rows) {
      if (await followAgent(client, id, teammate)) followed.push(id);
    }
    if (followed.length === 0) return followed;
    await client.query(
      `UPDATE provider_sessions SET closed_at = now(), close_reason = $2
       WHERE conversation_id = ANY($1::uuid[]) AND closed_at IS NULL`,
      [followed, SESSION_CLOSE_REASONS.settings],
    );
    await client.query(
      `INSERT INTO chat_notes (conversation_id, kind, name)
       SELECT c.id, 'spark_settings', $2 FROM conversations c
       WHERE c.id = ANY($1::uuid[])
         AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`,
      [followed, teammate.name],
    );
    return followed;
  });
}

export async function openHomeThread(
  db: Db,
  workspaceId: string,
  teammateId: string,
): Promise<TeammateChat> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT id FROM teammates WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [
      workspaceId,
      teammateId,
    ]);
    const teammate = await getTeammate(client, workspaceId, teammateId);
    const tag = { id: teammate.id, name: teammate.name, role: teammate.role, face: teammate.face };
    if (teammate.homeConversationId) {
      return { conversationId: teammate.homeConversationId, teammate: tag };
    }
    const conversationId = newId();
    await client.query(
      `INSERT INTO conversations (id, workspace_id, title, title_source)
       VALUES ($1, $2, $3, 'user')`,
      [conversationId, workspaceId, teammate.name],
    );
    await attach(client, workspaceId, conversationId, teammate);
    await client.query('UPDATE teammates SET home_conversation_id = $2 WHERE id = $1', [
      teammateId,
      conversationId,
    ]);
    return { conversationId, teammate: tag };
  });
}

export async function teammateBrief(
  db: Queryable,
  conversationId: string,
): Promise<StoredSparkBrief | null> {
  const { rows } = await db.query<StoredSparkBrief>(
    `SELECT t.id, t.name, t.role, t.instructions,
       t.instructions_moved_at IS NOT NULL AS "instructionsMoved",
       t.instructions_path AS "instructionsPath"
     FROM conversations c
     JOIN teammates t ON t.id = c.teammate_id WHERE c.id = $1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export async function closeTeammateSessions(
  db: Queryable,
  workspaceId: string,
  teammateId: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE provider_sessions s SET closed_at = now(), close_reason = $3
     FROM conversations c
     WHERE c.id = s.conversation_id AND c.workspace_id = $1 AND c.teammate_id = $2
       AND s.closed_at IS NULL`,
    [workspaceId, teammateId, SESSION_CLOSE_REASONS.settings],
  );
  return rowCount ?? 0;
}
