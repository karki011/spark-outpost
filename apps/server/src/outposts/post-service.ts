import {
  handleProblem,
  parseAddress,
  type CreateOutpostRequest,
  type MemberRequest,
  type OutpostMember,
} from '@spark-outpost/contracts';
import { redactText, storableText } from '../audit/redact.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { getPost, insertPosts, rejectWaiting } from '../persistence/outpost-posts.ts';
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
import { joinNotice } from './handshake.ts';
import type { RequestAuthor, StoredOutpost, StoredPost } from './ports.ts';
import { planPost } from './post-rules.ts';

export const POST_ID_IN_USE = 'That post id is already in use.';

export interface PostServiceDeps {
  db: Db;
  workspaceId: string;
}

export interface PostInput {
  outpostId: string;
  author: RequestAuthor;
  text: string;
  id?: string;
  guestConversationId?: string;
}

export interface JoinInput extends MemberRequest {
  outpostId: string;
}

function storedBody(body: string): string {
  return storableText(redactText(body));
}

async function knownOutpost(
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
  const sameAuthor = existing.fromUser === (input.author.kind === 'user');
  if (existing.outpostId !== input.outpostId || !sameAuthor) {
    throw new OutpostError(409, POST_ID_IN_USE);
  }
  return existing;
}

export async function postToOutpost(
  { db, workspaceId }: PostServiceDeps,
  input: PostInput,
): Promise<StoredPost[]> {
  return withTransaction(db, async (client) => {
    const outpost = await knownOutpost(client, workspaceId, input.outpostId);
    const repeated = await repeatedPost(client, input);
    if (repeated) return [repeated];
    const address = parseAddress(
      input.text,
      outpost.members.map((member) => member.handle),
    );
    const plan = planPost(
      input.author,
      address,
      outpost.members,
      { id: outpost.id, paused: outpost.pausedAt !== null },
      input.guestConversationId ?? null,
    );
    if (plan.kind === 'refusal') throw new OutpostError(400, plan.message);
    const posts = await insertPosts(
      client,
      plan.posts.map((post, index) => ({
        ...post,
        id: index === 0 && input.id !== undefined ? input.id : newId(),
        body: storedBody(post.body),
      })),
    );
    await notifyOutpostChanged(client, outpost.id);
    return posts;
  });
}

async function addWithNotice(
  db: Queryable,
  outpost: StoredOutpost,
  member: MemberRequest,
): Promise<OutpostMember> {
  const handles = outpost.members.map((existing) => existing.handle);
  const problem = handleProblem(member.handle, handles);
  if (problem) throw new OutpostError(400, problem);
  const added = await addMember(db, outpost.id, member);
  await insertPosts(db, [
    {
      id: newId(),
      outpostId: outpost.id,
      kind: 'notice',
      body: joinNotice(added.handle, [...handles, added.handle]),
      fromUser: false,
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
    await rejectWaiting(client, outpost.id, input.conversationId, 'not_member');
    await notifyOutpostChanged(client, outpost.id);
    return true;
  });
}

export async function openOutpost(
  { db, workspaceId }: PostServiceDeps,
  request: CreateOutpostRequest,
): Promise<{ outpost: StoredOutpost; created: boolean }> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [request.id]);
    const existing = await getOutpost(client, workspaceId, request.id);
    if (existing) return { outpost: existing, created: false };
    let outpost = await createOutpost(client, {
      id: request.id,
      workspaceId,
      name: request.name,
      members: [],
    });
    for (const member of request.members) {
      await addWithNotice(client, outpost, member);
      outpost = await knownOutpost(client, workspaceId, outpost.id);
    }
    await notifyOutpostChanged(client, outpost.id);
    return { outpost, created: true };
  });
}
