import { randomUUID } from 'node:crypto';
import type { RunStatus } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDispatcher } from '../src/a2a/dispatcher.ts';
import { asAgentReads } from '../src/outposts/agent-prompt.ts';
import { toOutpostPost } from '../src/outposts/post-view.ts';
import { queueWrapUps } from '../src/outposts/story-wrap-ups.ts';
import { userText } from '../src/outposts/user-asked.ts';
import { markStarted, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { getPost, insertPosts, listPosts } from '../src/persistence/outpost-posts.ts';
import { insertTasks } from '../src/persistence/outpost-stories.ts';
import { createOutpost, removeMember, setPaused } from '../src/persistence/outposts.ts';
import { getRun } from '../src/persistence/runs.ts';
import { startedByRequest } from '../src/spark-mcp/tools/outpost-turn.ts';
import { publishGrant } from '../src/workflow/publish-context.ts';
import { publishReason } from '../src/workflow/publish-step-reason.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { acceptingPeer, type AcceptingPeer } from './accepting-peer.ts';
import { postRunId } from './outpost-fixtures.ts';
import { carry, chatWithTurn, newChat, reply, setRun } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let peer: AcceptingPeer;
let outpostId: string;
let lead: string;
let api: string;
let web: string;

interface Story {
  draftId: string;
  posts: Record<string, string>;
}

async function opening(to: string, handle: string, afterPostId: string | null): Promise<string> {
  const [post] = await insertPosts(t.db, [
    {
      id: randomUUID(),
      outpostId,
      kind: 'request',
      body: `Build ${handle}.`,
      fromUser: false,
      fromConversationId: lead,
      fromHandle: 'lead',
      toHandle: handle,
      toConversationId: to,
      opening: true,
      userStarted: true,
      afterPostId,
    },
  ]);
  return post!.id;
}

async function draft(title: string): Promise<string> {
  const draftId = randomUUID();
  await saveDraft(t.db, {
    id: draftId,
    workspaceId: t.workspaceId,
    conversationId: lead,
    runId: null,
    outpostId: null,
    body: {
      title,
      chats: [{ handle: 'api', title: 'Orders endpoint', projectId: randomUUID(), task: 'Add.' }],
    },
  });
  return draftId;
}

async function startedStory(title = 'Checkout'): Promise<Story> {
  const draftId = await draft(title);
  await markStarted(t.db, draftId, outpostId);
  const apiPost = await opening(api, 'api', null);
  const webPost = await opening(web, 'web', apiPost);
  const common = { outpostId, draftId, leadConversationId: lead };
  await insertTasks(t.db, [
    {
      ...common,
      conversationId: api,
      title: 'Orders endpoint',
      position: 0,
      dependsOnConversationId: null,
      openingPostId: apiPost,
    },
    {
      ...common,
      conversationId: web,
      title: 'Checkout page',
      position: 1,
      dependsOnConversationId: api,
      openingPostId: webPost,
    },
  ]);
  return { draftId, posts: { api: apiPost, web: webPost } };
}

async function end(postId: string, chat: string, status: RunStatus, answer?: string) {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [turn.runId, chat]);
  await carry(t, postId, turn.runId);
  if (answer !== undefined) await reply(t, turn.runId, answer);
  await setRun(t, turn.runId, status);
}

async function answerBoth(story: Story): Promise<void> {
  await end(story.posts.api!, api, 'succeeded', 'The endpoint is in.');
  await end(story.posts.web!, web, 'succeeded', 'The page is in.');
}

async function reportedAt(draftId: string): Promise<Date | null> {
  const { rows } = await t.db.query<{ reported_at: Date | null }>(
    'SELECT reported_at FROM outpost_drafts WHERE id = $1',
    [draftId],
  );
  return rows[0]!.reported_at;
}

async function toLead() {
  return (await listPosts(t.db, outpostId))
    .map(({ post }) => post)
    .filter((post) => post.toConversationId === lead);
}

async function onePass(): Promise<void> {
  await startDispatcher({ db: t.db, peer }).close();
}

beforeEach(async () => {
  t = await createTestDb();
  peer = acceptingPeer(t);
  [lead, api, web] = [await newChat(t), await newChat(t), await newChat(t)];
  outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [
      { conversationId: lead, handle: 'lead' },
      { conversationId: api, handle: 'api' },
      { conversationId: web, handle: 'web' },
    ],
  });
});

afterEach(async () => {
  await t.cleanup();
});

describe('the wrap-up turn of a story', () => {
  it.each([
    ['is still held', async (_story: Story) => undefined],
    ['is working', (story: Story) => end(story.posts.web!, web, 'running')],
    [
      'asks the user',
      (story: Story) => end(story.posts.web!, web, 'succeeded', 'Half.\n\nNeeds you: which?'),
    ],
  ])('is not written while a sub-task %s', async (_name, second) => {
    const story = await startedStory();
    await end(story.posts.api!, api, 'succeeded', 'Done.');
    await second(story);

    expect(await queueWrapUps(t.db)).toBe(0);
    expect(await toLead()).toEqual([]);
    expect(await reportedAt(story.draftId)).toBeNull();
  });

  it('is one request to the lead chat that is not the user’s and names every sub-task', async () => {
    const story = await startedStory();
    await answerBoth(story);

    expect(await queueWrapUps(t.db)).toBe(1);

    const [post, ...others] = await toLead();
    expect(others).toEqual([]);
    expect(post).toMatchObject({
      id: story.draftId,
      kind: 'request',
      fromUser: false,
      userStarted: false,
      fromConversationId: null,
      fromHandle: null,
      fromRunId: null,
      toHandle: 'lead',
      opening: false,
      afterPostId: null,
      taskId: null,
    });
    expect(post!.body).toContain('the story "Checkout"');
    expect(post!.body).toContain('@api (Orders endpoint): answered');
    expect(post!.body).toContain('@web (Checkout page): answered · started after @api');
    expect(await reportedAt(story.draftId)).not.toBeNull();
  });

  it('is written once, however many wakes and restarts follow', async () => {
    const story = await startedStory();
    await answerBoth(story);

    const counts = await Promise.all([1, 2, 3, 4].map(() => queueWrapUps(t.db)));
    await onePass();
    await onePass();

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await toLead()).toHaveLength(1);
    expect(peer.sent.filter((sent) => sent.postId === story.draftId)).toHaveLength(1);
  });

  it('is written by the dispatcher pass and starts a turn that carries no user request', async () => {
    const story = await startedStory();
    await answerBoth(story);

    await onePass();
    await drainQueue(t.db, lead, async () => ({ provider: 'claude' }));

    const runId = (await postRunId(t.db, story.draftId))!;
    const run = (await getRun(t.db, runId))!;
    expect(run.outpost).toMatchObject({ fromUser: false, fromSpark: true, fromHandle: null });
    expect(startedByRequest(run)).toBe(true);
    const shown = (await listPosts(t.db, outpostId)).map((post) => toOutpostPost(post, null));
    expect(shown.filter((post) => post.fromSpark).map((post) => post.id)).toEqual([story.draftId]);
    await t.db.query(`UPDATE runs SET mode = 'do', level = 'hands-off' WHERE id = $1`, [runId]);
    const input = await loadRunInput(t.db, runId);
    expect(input.outpostRequest).toMatchObject({
      fromUser: false,
      userStarted: false,
      wrapUp: true,
    });
    expect(asAgentReads(input).prompt.split('\n')[0]).toBe(
      '[Story wrap-up, written by Spark in the outpost "Orders launch". This is not from the user.]',
    );
    expect(userText(input)).toBe('');
    expect(publishGrant(input).requested).toBe(false);
    expect(publishReason(input)).toBeNull();
  });

  it('is written when the story ends with a failed and a cancelled sub-task', async () => {
    const story = await startedStory();
    await end(story.posts.api!, api, 'failed');
    await t.db.query(
      `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE id = $1`,
      [story.posts.web],
    );

    expect(await queueWrapUps(t.db)).toBe(1);

    const body = (await getPost(t.db, story.draftId))!.post.body;
    expect(body).toContain("@api (Orders endpoint): failed (@api's turn failed)");
    expect(body).toContain('@web (Checkout page): cancelled · started after @api');
  });

  it('waits while the outpost is paused and is written on resume', async () => {
    const story = await startedStory();
    await answerBoth(story);
    await setPaused(t.db, t.workspaceId, outpostId, true);

    expect(await queueWrapUps(t.db)).toBe(0);
    expect(await reportedAt(story.draftId)).toBeNull();

    await setPaused(t.db, t.workspaceId, outpostId, false);
    expect(await queueWrapUps(t.db)).toBe(1);
  });

  it('is not written, and the story is not marked, when the lead chat left or was deleted', async () => {
    const left = await startedStory('Left');
    await answerBoth(left);
    await removeMember(t.db, outpostId, lead);

    expect(await queueWrapUps(t.db)).toBe(0);
    expect(await reportedAt(left.draftId)).toBeNull();

    await t.db.query('DELETE FROM conversations WHERE id = $1', [lead]);
    expect(await queueWrapUps(t.db)).toBe(0);
    expect(await reportedAt(left.draftId)).toBeNull();
  });

  it('is not written for a draft that was never started', async () => {
    const draftId = await draft('Not started');

    expect(await queueWrapUps(t.db)).toBe(0);
    expect(await reportedAt(draftId)).toBeNull();
  });

  it('is written per story: one settled story does not wait for another', async () => {
    const done = await startedStory('Done');
    await answerBoth(done);
    const docs = await newChat(t);
    await t.db.query(
      `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
       VALUES ($1, $2, 'docs', 9)`,
      [outpostId, docs],
    );
    const openDraft = await draft('Open');
    await markStarted(t.db, openDraft, outpostId);
    const docsPost = await opening(docs, 'docs', null);
    await insertTasks(t.db, [
      {
        outpostId,
        draftId: openDraft,
        leadConversationId: lead,
        conversationId: docs,
        title: 'Docs',
        position: 0,
        dependsOnConversationId: null,
        openingPostId: docsPost,
      },
    ]);

    expect(await queueWrapUps(t.db)).toBe(1);
    expect((await toLead()).map((post) => post.id)).toEqual([done.draftId]);
    expect(await reportedAt(openDraft)).toBeNull();

    await end(docsPost, docs, 'succeeded', 'Written.');
    expect(await queueWrapUps(t.db)).toBe(1);
    expect((await getPost(t.db, openDraft))!.post.body).toContain('@docs (Docs): answered');
  });
});
