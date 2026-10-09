import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestState, type RunStatus } from '@spark-outpost/contracts';
import {
  cancelUnsent,
  closePost,
  getPost,
  insertPosts,
  listPosts,
  rejectWaiting,
  requestAnswer,
  unsentRequests,
} from '../src/persistence/outpost-posts.ts';
import { createOutpost, setPaused } from '../src/persistence/outposts.ts';
import {
  accept,
  carry,
  chatWithTurn,
  newChat,
  reply,
  setRun,
  userRequest,
} from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: { conversationId: string; runId: string };

beforeEach(async () => {
  t = await createTestDb();
  api = await chatWithTurn(t);
  await setRun(t, api.runId, 'succeeded');
  outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [{ conversationId: api.conversationId, handle: 'api' }],
  });
});

afterEach(async () => {
  await t.cleanup();
});

async function request(): Promise<string> {
  const [post] = await insertPosts(t.db, [userRequest(outpostId, api.conversationId, 'api')]);
  return post!.id;
}

async function stateOf(postId: string) {
  const found = await getPost(t.db, postId);
  return requestState(found!.facts!);
}

async function receivingRun(postId: string, status: RunStatus): Promise<string> {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [
    turn.runId,
    api.conversationId,
  ]);
  await carry(t, postId, turn.runId);
  await setRun(t, turn.runId, status);
  return turn.runId;
}

describe('the facts a request state is derived from', () => {
  it('reads Sent, not sent yet, for a request nothing has accepted', async () => {
    const found = await getPost(t.db, await request());

    expect(found?.facts).toEqual({
      toHandle: 'api',
      closedState: null,
      closedReason: null,
      sent: false,
      queued: false,
      runStatus: null,
      runNeedsYou: null,
      paused: false,
      held: false,
      chatDeleted: false,
      waitingOn: null,
    });
    expect(requestState(found!.facts!)).toEqual({ state: 'sent', reason: 'Not sent yet' });
  });

  it('reads Sent once it waits in the receiving queue', async () => {
    const postId = await request();
    await accept(t, postId);

    expect((await getPost(t.db, postId))?.facts).toMatchObject({ sent: true, queued: true });
    expect(await stateOf(postId)).toEqual({ state: 'sent', reason: null });
  });

  it('says the queue is held when the receiving chat ended its last turn badly', async () => {
    const postId = await request();
    await accept(t, postId);
    await setRun(t, api.runId, 'failed');

    expect(await stateOf(postId)).toEqual({
      state: 'sent',
      reason: "Waiting: @api's last turn failed",
    });

    await setRun(t, api.runId, 'running');
    expect(await stateOf(postId)).toEqual({ state: 'sent', reason: null });
  });

  it('reads Sent, Paused, while the outpost is paused', async () => {
    const postId = await request();
    await setPaused(t.db, t.workspaceId, outpostId, true);

    expect(await stateOf(postId)).toEqual({ state: 'sent', reason: 'Paused' });
  });

  it('follows the receiving run through each status', async () => {
    const expected: [RunStatus, string][] = [
      ['queued', 'sent'],
      ['running', 'working'],
      ['awaiting_approval', 'needs_you'],
      ['succeeded', 'answered'],
      ['failed', 'failed'],
      ['outcome_unknown', 'failed'],
      ['cancelled', 'cancelled'],
    ];
    for (const [status, state] of expected) {
      const postId = await request();
      await receivingRun(postId, status);
      expect((await stateOf(postId)).state, status).toBe(state);
    }
  });

  it('reads Needs you with the question when the reply ends with one', async () => {
    const postId = await request();
    const runId = await receivingRun(postId, 'succeeded');
    await reply(t, runId, 'I can do either.\n\nNeeds you: REST or GraphQL?');

    expect((await getPost(t.db, postId))?.facts?.runNeedsYou).toBe('Needs you: REST or GraphQL?');
    expect(await stateOf(postId)).toEqual({ state: 'needs_you', reason: 'REST or GraphQL?' });
  });

  it('lets a closed request win over its run and keeps the stored reason', async () => {
    const cancelled = await request();
    await receivingRun(cancelled, 'succeeded');
    expect(await closePost(t.db, cancelled, { state: 'cancelled', reason: null })).toBe(true);
    expect(await closePost(t.db, cancelled, { state: 'failed', reason: 'Too late.' })).toBe(false);
    expect(await stateOf(cancelled)).toEqual({ state: 'cancelled', reason: null });

    const rejected = await request();
    await closePost(t.db, rejected, { state: 'rejected', reason: 'queue_full' });
    expect(await stateOf(rejected)).toEqual({
      state: 'failed',
      reason: 'Not delivered: queue full',
    });

    const failed = await request();
    await closePost(t.db, failed, { state: 'failed', reason: 'The chat could not be reached.' });
    expect(await stateOf(failed)).toEqual({
      state: 'failed',
      reason: 'The chat could not be reached.',
    });
    expect((await getPost(t.db, failed))?.post.closedAt).not.toBeNull();
  });

  it('keeps the handle and reads Failed, chat deleted, after the receiving chat is deleted', async () => {
    const postId = await request();
    await receivingRun(postId, 'running');
    await t.db.query('DELETE FROM conversations WHERE id = $1', [api.conversationId]);

    const found = await getPost(t.db, postId);
    expect(found?.post).toMatchObject({ toHandle: 'api', toConversationId: null, runId: null });
    expect(requestState(found!.facts!)).toEqual({ state: 'failed', reason: 'Chat deleted' });
  });

  it('gives a note and a notice no facts', async () => {
    const [note, notice] = await insertPosts(t.db, [
      { id: randomUUID(), outpostId, kind: 'note', body: 'Shipping Friday.', fromUser: true },
      { id: randomUUID(), outpostId, kind: 'notice', body: '@api joined.', fromUser: false },
    ]);

    expect((await getPost(t.db, note!.id))?.facts).toBeNull();
    expect((await getPost(t.db, notice!.id))?.facts).toBeNull();
    expect(await closePost(t.db, note!.id, { state: 'cancelled', reason: null })).toBe(false);
  });
});

describe('storing posts', () => {
  it('lists a thread in the order it was written, with one ISO time format', async () => {
    const ids = [await request(), await request(), await request()];
    const listed = await listPosts(t.db, outpostId);

    expect(listed.map((found) => found.post.id)).toEqual(ids);
    for (const { post } of listed) {
      expect(post.createdAt).toBe(new Date(post.createdAt).toISOString());
    }
    expect(await listPosts(t.db, randomUUID())).toEqual([]);
    expect(await getPost(t.db, randomUUID())).toBeNull();
  });

  it('returns the first post when the same id is inserted again', async () => {
    const first = userRequest(outpostId, api.conversationId, 'api');
    const [stored] = await insertPosts(t.db, [first]);
    const [again] = await insertPosts(t.db, [{ ...first, body: 'Something else' }]);

    expect(again).toEqual(stored);
    expect(await listPosts(t.db, outpostId)).toHaveLength(1);
  });

  it('stores an identical ask from one run once', async () => {
    const fe = await chatWithTurn(t);
    const ask = {
      ...userRequest(outpostId, api.conversationId, 'api'),
      fromUser: false,
      fromConversationId: fe.conversationId,
      fromRunId: fe.runId,
      fromHandle: 'fe',
      requestHash: 'hash-1',
      waits: true,
      observed: [{ source: 'web_page' as const, label: 'example.com' }],
    };

    const [stored] = await insertPosts(t.db, [ask]);
    const [again] = await insertPosts(t.db, [{ ...ask, id: randomUUID() }]);
    const [other] = await insertPosts(t.db, [{ ...ask, id: randomUUID(), requestHash: 'hash-2' }]);

    expect(stored).toMatchObject({
      fromUser: false,
      fromHandle: 'fe',
      waits: true,
      observed: [{ source: 'web_page', label: 'example.com' }],
    });
    expect(again?.id).toBe(stored?.id);
    expect(other?.id).not.toBe(stored?.id);
  });

  it('keeps the sender handle and never reads as the user after the sending chat is deleted', async () => {
    const fe = await chatWithTurn(t);
    const [stored] = await insertPosts(t.db, [
      {
        ...userRequest(outpostId, api.conversationId, 'api'),
        fromUser: false,
        fromConversationId: fe.conversationId,
        fromRunId: fe.runId,
        fromHandle: 'fe',
      },
    ]);
    await t.db.query('DELETE FROM conversations WHERE id = $1', [fe.conversationId]);

    expect((await getPost(t.db, stored!.id))?.post).toMatchObject({
      fromUser: false,
      fromConversationId: null,
      fromRunId: null,
      fromHandle: 'fe',
    });
  });
});

describe('requests waiting to be sent', () => {
  it('lists unsent open requests in order and leaves out sent, closed and paused ones', async () => {
    const [first, second, sent, closed] = [
      await request(),
      await request(),
      await request(),
      await request(),
    ];
    await accept(t, sent);
    await closePost(t.db, closed, { state: 'cancelled', reason: null });
    await insertPosts(t.db, [
      { id: randomUUID(), outpostId, kind: 'note', body: 'A note.', fromUser: true },
    ]);

    expect((await unsentRequests(t.db)).map((post) => post.id)).toEqual([first, second]);

    await setPaused(t.db, t.workspaceId, outpostId, true);
    expect(await unsentRequests(t.db)).toEqual([]);
    await setPaused(t.db, t.workspaceId, outpostId, false);
    expect(await unsentRequests(t.db)).toHaveLength(2);
  });

  it('leaves out a request whose receiving chat was deleted', async () => {
    await request();
    await t.db.query('DELETE FROM conversations WHERE id = $1', [api.conversationId]);

    expect(await unsentRequests(t.db)).toEqual([]);
  });

  it('cancels a request only while nothing has accepted it', async () => {
    const [unsent, sent] = [await request(), await request()];
    await accept(t, sent);

    expect(await cancelUnsent(t.db, unsent)).toBe(true);
    expect(await cancelUnsent(t.db, unsent)).toBe(false);
    expect(await cancelUnsent(t.db, sent)).toBe(false);
    expect((await stateOf(unsent)).state).toBe('cancelled');
    expect((await stateOf(sent)).state).toBe('sent');
  });

  it('rejects the unsent and queued requests to a chat and leaves a started one alone', async () => {
    const [unsent, queued, started] = [await request(), await request(), await request()];
    await accept(t, queued);
    await receivingRun(started, 'running');
    const other = await newChat(t);
    await t.db.query(
      `INSERT INTO chat_queue (id, conversation_id, position, content) VALUES ($1, $2, 9, 'mine')`,
      [randomUUID(), api.conversationId],
    );

    expect(await rejectWaiting(t.db, outpostId, other, 'not_member')).toBe(0);
    expect(await rejectWaiting(t.db, outpostId, api.conversationId, 'not_member')).toBe(2);

    for (const postId of [unsent, queued]) {
      expect(await stateOf(postId)).toEqual({
        state: 'failed',
        reason: 'Not delivered: no longer a member',
      });
    }
    expect((await stateOf(started)).state).toBe('working');
    const left = await t.db.query<{ content: string }>(
      'SELECT content FROM chat_queue WHERE conversation_id = $1',
      [api.conversationId],
    );
    expect(left.rows.map((row) => row.content)).toEqual(['mine']);
  });
});

describe('the answer to a request', () => {
  it('is the last reply of the receiving run, with secrets redacted', async () => {
    const postId = await request();
    const runId = await receivingRun(postId, 'succeeded');
    await reply(t, runId, 'Looking.');
    await reply(
      t,
      runId,
      'The key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 and it works.',
    );

    const answer = await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, postId))!);

    expect(answer).toMatchObject({ branch: null, changes: [], pullRequests: [] });
    expect(answer?.text).toContain('and it works.');
    expect(answer?.text).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('clips the text only when the caller asks', async () => {
    const postId = await request();
    const runId = await receivingRun(postId, 'succeeded');
    await reply(t, runId, 'a'.repeat(50));
    const found = (await getPost(t.db, postId))!;

    expect((await requestAnswer(t.db, t.workspaceId, found))?.text).toHaveLength(50);
    expect((await requestAnswer(t.db, t.workspaceId, found, { maxChars: 10 }))?.text).toBe(
      `${'a'.repeat(10)}… (50 chars)`,
    );
  });

  it('names the branch and the pull requests recorded since the turn started', async () => {
    const postId = await request();
    const runId = await receivingRun(postId, 'succeeded');
    await reply(t, runId, 'Opened a pull request.');
    const taskId = randomUUID();
    await t.db.query(`INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, 'Orders')`, [
      taskId,
      api.conversationId,
    ]);
    await t.db.query('UPDATE runs SET task_id = $2 WHERE id = $1', [runId, taskId]);
    const projectId = randomUUID();
    await t.db.query(
      `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, 'api', '/repos/api')`,
      [projectId, t.workspaceId],
    );
    await t.db.query(
      `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
         base_branch, base_commit, in_place, owns_branch)
       VALUES ($1, $2, $3, '/repos/api', '/repos/api-wt', 'spark/orders', 'main', 'abc', false, true)`,
      [randomUUID(), api.conversationId, projectId],
    );
    await t.db.query(
      `INSERT INTO task_links (id, task_id, kind, url, title, source, created_at) VALUES
         ($1, $3, 'pr', 'https://github.com/acme/api/pull/7', 'Orders', 'tool_output', now()),
         ($2, $3, 'pr', 'https://github.com/acme/api/pull/1', 'Old', 'tool_output', now() - interval '1 day')`,
      [randomUUID(), randomUUID(), taskId],
    );

    const answer = await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, postId))!);

    expect(answer?.branch).toBe('spark/orders');
    expect(answer?.pullRequests).toEqual(['https://github.com/acme/api/pull/7']);
  });

  it('is absent until the run succeeds, for a closed request and for a note', async () => {
    const working = await request();
    const runId = await receivingRun(working, 'running');
    await reply(t, runId, 'Part way.');
    expect(await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, working))!)).toBeNull();

    await setRun(t, runId, 'succeeded');
    expect(
      await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, working))!),
    ).not.toBeNull();

    await closePost(t.db, working, { state: 'cancelled', reason: null });
    expect(await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, working))!)).toBeNull();

    expect(
      await requestAnswer(t.db, t.workspaceId, (await getPost(t.db, await request()))!),
    ).toBeNull();
  });
});
