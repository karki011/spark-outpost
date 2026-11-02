import { parseChatReference } from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { outpostOf } from '../../persistence/outposts.ts';
import { storyTaskOf } from '../../persistence/outpost-stories.ts';
import { SparkToolError } from '../tool.ts';

export interface ReusedChat {
  chatId: string;
  projectId: string;
  handle: string | null;
}

export interface ReuseFacts {
  db: Queryable;
  workspaceId: string;
  leadChatId: string;
  leadOutpostId: string | null;
}

export const CHAT_AND_PROJECT =
  'Give each chat either project (a new chat) or chat (an existing chat that gets a request), not both.';
export const CHAT_NEEDS_PROJECT_OR_CHAT =
  'Give each chat a project for a new chat, or chat for an existing chat that gets a request.';

export function reuseRefusal(handle: string, why: string): string {
  return `@${handle}: ${why}`;
}

interface ChatRow {
  session_type: string;
  archived_at: Date | null;
  project_id: string | null;
}

async function chatRow(facts: ReuseFacts, chatId: string): Promise<ChatRow | null> {
  const { rows } = await facts.db.query<ChatRow>(
    `SELECT c.session_type, c.archived_at,
            (SELECT cp.project_id FROM conversation_projects cp WHERE cp.conversation_id = c.id
             ORDER BY cp.position, cp.created_at LIMIT 1) AS project_id
     FROM conversations c WHERE c.id = $1 AND c.workspace_id = $2`,
    [chatId, facts.workspaceId],
  );
  return rows[0] ?? null;
}

function refuse(handle: string, why: string): never {
  throw new SparkToolError(reuseRefusal(handle, why));
}

export async function reusedChat(
  facts: ReuseFacts,
  handle: string,
  reference: string,
): Promise<ReusedChat> {
  const chatId = parseChatReference(reference);
  if (!chatId) refuse(handle, 'pass a chat id or a chat link from spark_chats.');
  if (chatId === facts.leadChatId) refuse(handle, 'this chat cannot send a request to itself.');
  const row = await chatRow(facts, chatId);
  if (!row) refuse(handle, 'no chat with that id.');
  if (row.session_type === 'terminal') refuse(handle, 'a Terminal session cannot join an outpost.');
  if (row.archived_at !== null) refuse(handle, 'that chat is archived.');
  if (row.project_id === null) refuse(handle, 'that chat has no project; propose a new chat.');
  if (await storyTaskOf(facts.db, chatId)) refuse(handle, 'that chat is already in a story.');
  const joined = await outpostOf(facts.db, chatId);
  if (joined && joined.outpost.id !== facts.leadOutpostId) {
    refuse(handle, 'that chat is already in another outpost.');
  }
  return { chatId, projectId: row.project_id, handle: joined?.member.handle ?? null };
}
