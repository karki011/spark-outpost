import { randomUUID } from 'node:crypto';
import { modeForLegacy } from '@spark-outpost/contracts';
import {
  draftChatSettings,
  resolveChatSettings,
  updateChatSettings,
} from '../persistence/chat-settings.ts';
import { createConversation } from '../persistence/conversations.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';

export const ASSISTANT_TITLE = 'Ask Spark';

export const ASSISTANT_PREAMBLE = [
  'You are Spark, answering questions about Spark Outpost itself: the chats, what is running or waiting, spend, providers and settings.',
  'Look things up with the Spark tools and never guess.',
  'Answer in one to three short, plain sentences and name chats by their title.',
  'You cannot change files, run commands or take actions from here.',
].join(' ');

export class AssistantUnavailableError extends Error {}

async function followDefaults(db: Queryable, workspaceId: string, id: string): Promise<void> {
  const [defaults, current] = await Promise.all([
    draftChatSettings(db, workspaceId),
    resolveChatSettings(db, id),
  ]);
  const provider = defaults.provider;
  if (!provider) return;
  const readOnly = modeForLegacy(provider, null, null);
  if (provider === current.provider && current.agentMode === readOnly) return;
  await updateChatSettings(db, id, {
    provider,
    ...(readOnly ? { agentMode: readOnly } : {}),
  }).catch(() => null);
}

export async function ensureAssistantChat(db: Db, workspaceId: string): Promise<string> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<{ id: string | null }>(
      `SELECT assistant_conversation_id AS id FROM profiles WHERE workspace_id = $1 FOR UPDATE`,
      [workspaceId],
    );
    const profile = rows[0];
    if (!profile) throw new AssistantUnavailableError('Finish setting up Spark first.');
    if (profile.id) {
      await followDefaults(client, workspaceId, profile.id);
      return profile.id;
    }
    const id = randomUUID();
    await createConversation(client, workspaceId, id);
    await client.query(`UPDATE conversations SET title = $2, title_source = 'user' WHERE id = $1`, [
      id,
      ASSISTANT_TITLE,
    ]);
    await followDefaults(client, workspaceId, id);
    await client.query(
      'UPDATE profiles SET assistant_conversation_id = $2 WHERE workspace_id = $1',
      [workspaceId, id],
    );
    return id;
  });
}
