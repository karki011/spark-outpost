import { createHash } from 'node:crypto';
import {
  handleProblem,
  parseAddress,
  userAddress,
  type MemberRequest,
  type OutpostMember,
} from '@spark-outpost/contracts';
import { redactText, storableText } from '../audit/redact.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import {
  attachmentsFree,
  getPost,
  insertPosts,
  rejectWaiting,
} from '../persistence/outpost-posts.ts';
import {
  addMember,
  createOutpost,
  getOutpost,
  notifyOutpostChanged,
  OUTPOST_NOT_FOUND,
  OutpostError,
  removeMember,
  renameHandle,
} from '../persistence/outposts.ts';
import { removeTask } from '../persistence/outpost-stories.ts';
import { introLine } from './handshake.ts';
import { memberFacts } from './member-facts.ts';
import type { NewPost, RequestAuthor, StoredOutpost, StoredPost } from './ports.ts';
import { keptProblem, planPost, type PlanAddress, type PlannedPost } from './post-rules.ts';
import { labelsOf } from './read-labels.ts';

export const POST_ID_IN_USE = 'That post id is already in use.';
export const CHAT_NOT_IN_OUTPOST = 'That chat is not in this outpost.';
export const ATTACHMENT_NOT_FREE =
  'An attachment is missing or already sent. Remove it and attach the file again.';

export interface PostServiceDeps {
  db: Db;
  workspaceId: string;
}

export interface PostInput {
  outpostId: string;
  author: RequestAuthor;
  text: string;
  id?: string;
  to?: readonly string[];
  guestConversationId?: string;
  toConversationId?: string;
  attachmentIds?: readonly string[];
  opening?: boolean;
  waits?: boolean;
}

export type StoryRequest = Required<
  Pick<
    NewPost,
    | 'id'
    | 'outpostId'
    | 'body'
    | 'fromConversationId'
    | 'fromHandle'
    | 'toHandle'
    | 'toConversationId'
    | 'attachmentIds'
    | 'afterPostId'
  >
>;

export interface JoinInput extends MemberRequest {
  outpostId: string;
}

function storedBody(body: string): string {
  return storableText(redactText(body));
}

export async function knownOutpost(
  db: Queryable,
  workspaceId: string,
  outpostId: string,
): Promise<StoredOutpost> {
  const outpost = await getOutpost(db, workspaceId, outpostId);
  if (!outpost) throw new OutpostError(404, OUTPOST_NOT_FOUND);
  return outpost;
}

async function repeatedPost(db: Queryable, input: PostInput): Promise<StoredPost | null> {
  if (input.id === undefined) return null;
  const existing = (await getPost(db, input.id))?.post ?? null;
  if (!existing) return null;
  const author = input.author.kind === 'chat' ? input.author.conversationId : null;
  const sameAuthor = existing.fromUser ? author === null : existing.fromConversationId === author;
  if (existing.outpostId !== input.outpostId || !sameAuthor) {
    throw new OutpostError(409, POST_ID_IN_USE);
  }
  return existing;
}

function typedByUser(input: PostInput, handles: readonly string[]): PlanAddress {
  const kept = input.to?.map((handle) => handle.toLowerCase());
  const problem = kept === undefined ? null : keptProblem(kept, input.text, handles);
  if (problem) throw new OutpostError(400, problem);
  const address = userAddress(input.text, handles, kept);
  if (address.kind === 'note') return address;
  const [only, ...others] = address.to;
  if (only !== undefined && others.length === 0) {
    return { kind: 'request', to: only, body: address.body };
  }
  return { kind: 'several', to: address.to, body: address.body };
}

function addressOf(input: PostInput, members: readonly OutpostMember[]): PlanAddress {
  const handles = members.map((member) => member.handle);
  if (input.toConversationId === undefined) {
    return input.author.kind === 'user'
      ? typedByUser(input, handles)
      : parseAddress(input.text, handles);
  }
  const member = members.find((candidate) => candidate.conversationId === input.toConversationId);
  if (!member) throw new OutpostError(400, CHAT_NOT_IN_OUTPOST);
  return { kind: 'request', to: member.handle, body: input.text.trim() };
}

function requestHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function chatRequestFacts(
  db: Queryable,
  input: PostInput,
  post: PlannedPost,
): Promise<Partial<NewPost>> {
  if (input.author.kind !== 'chat' || post.kind !== 'request') return {};
  return {
    requestHash: requestHash(post.body),
    waits: input.waits ?? false,
    observed: await labelsOf(db, input.author.runId),
  };
}

async function freeAttachments(
  db: Queryable,
  workspaceId: string,
  wanted: readonly string[],
): Promise<string[]> {
  const attachmentIds = [...new Set(wanted)];
  if (!(await attachmentsFree(db, workspaceId, attachmentIds))) {
    throw new OutpostError(400, ATTACHMENT_NOT_FREE);
  }
  return attachmentIds;
}

export async function postToOutpost(
  { db, workspaceId }: PostServiceDeps,
  input: PostInput,
): Promise<StoredPost[]> {
  return withTransaction(db, async (client) => {
    const outpost = await knownOutpost(client, workspaceId, input.outpostId);
    const repeated = await repeatedPost(client, input);
    if (repeated) return [repeated];
    const address = addressOf(input, outpost.members);
    const attachmentIds = await freeAttachments(client, workspaceId, input.attachmentIds ?? []);
    const plan = planPost(
      input.author,
      address,
      outpost.members,
      { id: outpost.id, paused: outpost.pausedAt !== null },
      input.guestConversationId ?? null,
    );
    if (plan.kind === 'refusal') throw new OutpostError(400, plan.message);
    const planned: NewPost[] = [];
    const batchId = plan.posts.length > 1 ? newId() : null;
    for (const [index, plannedPost] of plan.posts.entries()) {
      const post = { ...plannedPost, body: storedBody(plannedPost.body), batchId };
      planned.push({
        ...post,
        id: index === 0 && input.id !== undefined ? input.id : newId(),
        ...(post.kind === 'request' ? { attachmentIds, opening: input.opening ?? false } : {}),
        ...(await chatRequestFacts(client, input, post)),
      });
    }
    const posts = await insertPosts(client, planned);
    await notifyOutpostChanged(client, outpost.id);
    return posts;
  });
}

export async function postStoryRequest(
  { db, workspaceId }: PostServiceDeps,
  request: StoryRequest,
): Promise<StoredPost> {
  return withTransaction(db, async (client) => {
    const outpost = await knownOutpost(client, workspaceId, request.outpostId);
    const existing = (await getPost(client, request.id))?.post ?? null;
    if (existing) {
      const same =
        existing.outpostId === request.outpostId &&
        existing.userStarted &&
        existing.toConversationId === request.toConversationId;
      if (!same) throw new OutpostError(409, POST_ID_IN_USE);
      return existing;
    }
    const isMember = outpost.members.some(
      (member) => member.conversationId === request.toConversationId,
    );
    if (!isMember) throw new OutpostError(400, CHAT_NOT_IN_OUTPOST);
    const attachmentIds = await freeAttachments(client, workspaceId, request.attachmentIds);
    const [post] = await insertPosts(client, [
      {
        ...request,
        kind: 'request',
        body: storedBody(request.body),
        fromUser: false,
        attachmentIds,
        opening: true,
        userStarted: true,
      },
    ]);
    if (!post) throw new Error(`Outpost post ${request.id} was not stored.`);
    await notifyOutpostChanged(client, outpost.id);
    return post;
  });
}

export async function addWithNotice(
  db: Queryable,
  outpost: StoredOutpost,
  member: MemberRequest,
): Promise<OutpostMember> {
  const handles = outpost.members.map((existing) => existing.handle);
  const problem = handleProblem(member.handle, handles);
  if (problem) throw new OutpostError(400, problem);
  const added = await addMember(db, outpost.id, member);
  const facts = await memberFacts(db, added.conversationId);
  await insertPosts(db, [
    {
      id: newId(),
      outpostId: outpost.id,
      kind: 'notice',
      body: introLine({
        handle: added.handle,
        project: facts?.project ?? null,
        agent: facts?.agent ?? null,
        mode: facts?.mode ?? null,
      }),
      fromUser: false,
      fromConversationId: added.conversationId,
      fromHandle: added.handle,
    },
  ]);
  return added;
}

async function renameMember(
  db: Queryable,
  outpost: StoredOutpost,
  current: OutpostMember,
  handle: string,
): Promise<OutpostMember> {
  if (current.handle === handle) return current;
  const others = outpost.members
    .filter((member) => member.conversationId !== current.conversationId)
    .map((member) => member.handle);
  const problem = handleProblem(handle, others);
  if (problem) throw new OutpostError(400, problem);
  const renamed = await renameHandle(db, outpost.id, current.conversationId, handle);
  if (!renamed) throw new OutpostError(404, OUTPOST_NOT_FOUND);
  return renamed;
}

export async function joinOutpost(
  { db, workspaceId }: PostServiceDeps,
  input: JoinInput,
): Promise<OutpostMember> {
  return withTransaction(db, async (client) => {
    const outpost = await knownOutpost(client, workspaceId, input.outpostId);
    const current = outpost.members.find(
      (member) => member.conversationId === input.conversationId,
    );
    const member = current
      ? await renameMember(client, outpost, current, input.handle)
      : await addWithNotice(client, outpost, input);
    await notifyOutpostChanged(client, outpost.id);
    return member;
  });
}

export async function leaveOutpost(
  { db, workspaceId }: PostServiceDeps,
  input: { outpostId: string; conversationId: string },
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const outpost = await knownOutpost(client, workspaceId, input.outpostId);
    const removed = await removeMember(client, outpost.id, input.conversationId);
    if (!removed) return false;
    await removeTask(client, input.conversationId);
    await rejectWaiting(client, outpost.id, input.conversationId, 'not_member');
    await notifyOutpostChanged(client, outpost.id);
    return true;
  });
}

export async function openOutpost(
  { db, workspaceId }: PostServiceDeps,
  request: { id: string; name: string },
): Promise<{ created: boolean }> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [request.id]);
    if (await getOutpost(client, workspaceId, request.id)) return { created: false };
    await createOutpost(client, {
      id: request.id,
      workspaceId,
      name: request.name,
      members: [],
    });
    await notifyOutpostChanged(client, request.id);
    return { created: true };
  });
}
