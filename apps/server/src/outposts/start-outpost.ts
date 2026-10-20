import { stat } from 'node:fs/promises';
import {
  aboveLeadMode,
  startMemberChatId,
  type CreateOutpostRequest,
  type DraftChat,
  type FailedMember,
  type NewMemberChat,
  type StartMember,
} from '@spark-outpost/contracts';
import { updateChatSettings } from '../persistence/chat-settings.ts';
import { createConversation } from '../persistence/conversations.ts';
import { withTransaction, type Queryable } from '../persistence/db.ts';
import { getDraft } from '../persistence/outpost-drafts.ts';
import { insertTasks } from '../persistence/outpost-stories.ts';
import { getOutpost, notifyOutpostChanged, OutpostError } from '../persistence/outposts.ts';
import { InvalidDefaultError } from '../persistence/setup.ts';
import { chatPosture } from './chat-posture.ts';
import { modeAboveLead, userChoseMode } from './mode-cap.ts';
import type { StoredDraft } from './ports.ts';
import {
  addWithNotice,
  knownOutpost,
  openOutpost,
  postStoryRequest,
  postToOutpost,
  type PostServiceDeps,
} from './post-service.ts';
import { claimDraft, refuseEmptyStart } from './story-claim.ts';
import { DRAFT_ALREADY_STARTED, planStory, type StoryLead, type StoryPlan } from './story-start.ts';

export const CHAT_ID_IN_USE = 'That chat id is already in use.';
export const PROJECT_GONE = 'That project no longer exists. Choose another project.';
export const DRAFT_NOT_FOUND = 'That draft no longer exists.';
export const STARTS_AFTER_NEEDS_DRAFT = 'A chat can start after another only from a draft.';

export function parentNotSent(handle: string): string {
  return `It starts after @${handle}, whose first message was not sent.`;
}

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
    ...(chat.model ? { model: chat.model } : {}),
    ...(chat.agentMode ? { agentMode: chat.agentMode } : {}),
    ...(chat.level ? { level: chat.level } : {}),
  });
}

interface Story {
  draft: StoredDraft;
  plan: StoryPlan;
  proposed: readonly DraftChat[];
}

async function titleFromStory(db: Queryable, story: Story, conversationId: string): Promise<void> {
  const title = story.plan.tasks.find((task) => task.conversationId === conversationId)?.title;
  if (!title) return;
  await db.query(`UPDATE conversations SET title = $2, title_source = 'user' WHERE id = $1`, [
    conversationId,
    title,
  ]);
}

function proposedMode(story: Story, member: StartMember): string | null {
  return story.proposed.find((chat) => chat.handle === member.handle)?.agentMode ?? null;
}

async function holdToLeadMode(
  db: Queryable,
  workspaceId: string,
  lead: StoryLead,
  member: StartMember,
): Promise<void> {
  const { posture: leadPosture } = await chatPosture(db, workspaceId, lead.conversationId);
  const { posture } = await chatPosture(db, workspaceId, startMemberChatId(member));
  if (aboveLeadMode(leadPosture, posture)) {
    throw new OutpostError(400, modeAboveLead(member.handle, lead.handle));
  }
}

function joinStartMember(
  { db, workspaceId, folderExists = isFolder }: StartDeps,
  outpostId: string,
  member: StartMember,
  story: Story | null,
): Promise<void> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [outpostId]);
    const outpost = await knownOutpost(client, workspaceId, outpostId);
    const conversationId = startMemberChatId(member);
    if (outpost.members.some((joined) => joined.conversationId === conversationId)) return;
    if ('new' in member) {
      await createMemberChat(client, workspaceId, member.new, folderExists);
      if (story) await titleFromStory(client, story, conversationId);
      if (story && !userChoseMode(proposedMode(story, member), member.new.agentMode)) {
        await holdToLeadMode(client, workspaceId, story.plan.lead, member);
      }
    }
    await addWithNotice(client, outpost, { conversationId, handle: member.handle });
    await notifyOutpostChanged(client, outpost.id);
  });
}

function failure(member: StartMember, message: string): FailedMember {
  return { conversationId: startMemberChatId(member), handle: member.handle, message };
}

async function storyOf(
  { db, workspaceId }: StartDeps,
  request: CreateOutpostRequest,
): Promise<Story | null> {
  const { draftId } = request;
  if (draftId === undefined) {
    if (request.members.some((member) => member.dependsOn !== undefined)) {
      throw new OutpostError(400, STARTS_AFTER_NEEDS_DRAFT);
    }
    return null;
  }
  const draft = await getDraft(db, workspaceId, draftId);
  if (!draft) throw new OutpostError(404, DRAFT_NOT_FOUND);
  const joined = (await getOutpost(db, workspaceId, request.id))?.members ?? [];
  const handle = [...request.members, ...joined].find(
    (member) => 'conversationId' in member && member.conversationId === draft.conversationId,
  )?.handle;
  const plan = planStory(draft, request, handle ?? null);
  if (plan.kind === 'refusal') {
    throw new OutpostError(plan.message === DRAFT_ALREADY_STARTED ? 409 : 400, plan.message);
  }
  return { draft, plan, proposed: draft.body.chats };
}

async function sendFirstMessages(
  deps: StartDeps,
  request: CreateOutpostRequest,
  left: ReadonlySet<string>,
): Promise<FailedMember[]> {
  const failed: FailedMember[] = [];
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
  return failed;
}

async function sendStory(
  deps: StartDeps,
  { plan }: Story,
  left: ReadonlySet<string>,
): Promise<FailedMember[]> {
  const failed: FailedMember[] = [];
  const sent = new Set<string>();
  const handleOfPost = new Map(plan.posts.map((post) => [post.id, post.toHandle ?? '']));
  for (const post of plan.posts) {
    const conversationId = post.toConversationId ?? '';
    const handle = post.toHandle ?? '';
    if (left.has(conversationId)) continue;
    const refusal =
      post.afterPostId !== null && !sent.has(post.afterPostId)
        ? parentNotSent(handleOfPost.get(post.afterPostId) ?? '')
        : await refusalOf(() => postStoryRequest(deps, post));
    if (refusal === null) sent.add(post.id);
    else failed.push({ conversationId, handle, message: firstMessageNotSent(handle, refusal) });
  }
  await insertTasks(
    deps.db,
    plan.tasks
      .filter((task) => !left.has(task.conversationId))
      .map((task) => ({
        ...task,
        openingPostId:
          task.openingPostId !== null && sent.has(task.openingPostId) ? task.openingPostId : null,
        dependsOnConversationId:
          task.dependsOnConversationId !== null && left.has(task.dependsOnConversationId)
            ? null
            : task.dependsOnConversationId,
      })),
  );
  return failed;
}

export async function startOutpost(
  deps: StartDeps,
  request: CreateOutpostRequest,
): Promise<StartOutcome> {
  const story = await storyOf(deps, request);
  const { created } = await openOutpost(deps, request);
  const claim = story ? await claimDraft(deps, story.draft, request.id, created) : null;
  const failed: FailedMember[] = [];
  const left = new Set<string>();
  for (const member of request.members) {
    const refusal = await refusalOf(() => joinStartMember(deps, request.id, member, story));
    if (refusal === null) continue;
    failed.push(failure(member, refusal));
    left.add(startMemberChatId(member));
  }
  if (story && claim?.first && story.plan.tasks.every((task) => left.has(task.conversationId))) {
    return refuseEmptyStart(deps, claim, failed);
  }
  const unsent = story
    ? await sendStory(deps, story, left)
    : await sendFirstMessages(deps, request, left);
  return { created, failed: [...failed, ...unsent] };
}
