import { stat } from 'node:fs/promises';
import {
  startMemberChatId,
  type CreateOutpostRequest,
  type FailedMember,
  type NewMemberChat,
  type StartMember,
} from '@spark-outpost/contracts';
import { updateChatSettings } from '../persistence/chat-settings.ts';
import { createConversation } from '../persistence/conversations.ts';
import { withTransaction, type Queryable } from '../persistence/db.ts';
import { notifyOutpostChanged, OutpostError } from '../persistence/outposts.ts';
import { InvalidDefaultError } from '../persistence/setup.ts';
import {
  addWithNotice,
  knownOutpost,
  openOutpost,
  postToOutpost,
  type PostServiceDeps,
} from './post-service.ts';

export const CHAT_ID_IN_USE = 'That chat id is already in use.';
export const PROJECT_GONE = 'That project no longer exists. Choose another project.';

export function folderMissing(project: string): string {
  return `The folder for ${project} is missing. Restore it or choose another project.`;
}

export function firstMessageNotSent(handle: string, reason: string): string {
  return `@${handle} joined, but its first message was not sent. ${reason}`;
}

export type FolderExists = (path: string) => Promise<boolean>;

export interface StartDeps extends PostServiceDeps {
  folderExists?: FolderExists;
}

export interface StartOutcome {
  created: boolean;
  failed: FailedMember[];
}

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

async function refusalOf(work: () => Promise<unknown>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    if (error instanceof OutpostError || error instanceof InvalidDefaultError) return error.message;
    throw error;
  }
}

async function createMemberChat(
  db: Queryable,
  workspaceId: string,
  chat: NewMemberChat,
  folderExists: FolderExists,
): Promise<void> {
  const taken = await db.query('SELECT 1 FROM conversations WHERE id = $1', [chat.conversationId]);
  if (taken.rowCount === 1) throw new OutpostError(409, CHAT_ID_IN_USE);
  const project = await db.query<{ name: string; root_path: string }>(
    'SELECT name, root_path FROM projects WHERE id = $1 AND workspace_id = $2',
    [chat.projectId, workspaceId],
  );
  const found = project.rows[0];
  if (!found) throw new OutpostError(404, PROJECT_GONE);
  if (!(await folderExists(found.root_path)))
    throw new OutpostError(409, folderMissing(found.name));
  await createConversation(db, workspaceId, chat.conversationId, { projectIds: [chat.projectId] });
  await updateChatSettings(db, chat.conversationId, {
    provider: chat.provider,
    ...(chat.model ? { model: chat.model, routing: 'pinned' as const } : {}),
    ...(chat.agentMode ? { agentMode: chat.agentMode } : {}),
  });
}

function joinStartMember(
  { db, workspaceId, folderExists = isFolder }: StartDeps,
  outpostId: string,
  member: StartMember,
): Promise<void> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [outpostId]);
    const outpost = await knownOutpost(client, workspaceId, outpostId);
    const conversationId = startMemberChatId(member);
    if (outpost.members.some((joined) => joined.conversationId === conversationId)) return;
    if ('new' in member) await createMemberChat(client, workspaceId, member.new, folderExists);
    await addWithNotice(client, outpost, { conversationId, handle: member.handle });
    await notifyOutpostChanged(client, outpost.id);
  });
}

function failure(member: StartMember, message: string): FailedMember {
  return { conversationId: startMemberChatId(member), handle: member.handle, message };
}

export async function startOutpost(
  deps: StartDeps,
  request: CreateOutpostRequest,
): Promise<StartOutcome> {
  const { created } = await openOutpost(deps, request);
  const failed: FailedMember[] = [];
  const left = new Set<string>();
  for (const member of request.members) {
    const refusal = await refusalOf(() => joinStartMember(deps, request.id, member));
    if (refusal === null) continue;
    failed.push(failure(member, refusal));
    left.add(startMemberChatId(member));
  }
  for (const member of request.members) {
    const { firstMessage } = member;
    const conversationId = startMemberChatId(member);
    if (!firstMessage || left.has(conversationId)) continue;
    const refusal = await refusalOf(() =>
      postToOutpost(deps, {
        outpostId: request.id,
        author: { kind: 'user' },
        id: firstMessage.id,
        text: firstMessage.text,
        toConversationId: conversationId,
        attachmentIds: firstMessage.attachmentIds,
        opening: true,
      }),
    );
    if (refusal !== null) failed.push(failure(member, firstMessageNotSent(member.handle, refusal)));
  }
  return { created, failed };
}
