import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { turnObservations } from '../src/persistence/observations.ts';
import { getPost, insertPosts, listPosts } from '../src/persistence/outpost-posts.ts';
import { outpostNoteTool, NOTE_IS_ADDRESSED } from '../src/spark-mcp/tools/outpost-note-tool.ts';
import { outpostTool, REQUEST_NOT_HERE } from '../src/spark-mcp/tools/outpost-tool.ts';
import { NOT_FOR_PIECES, NOT_IN_OUTPOST } from '../src/spark-mcp/tools/outpost-turn.ts';
import { addMemberChat, createOutpostRow, finishRun } from './outpost-fixtures.ts';
import { carry, userRequest } from './outpost-store-support.ts';
import {
  chatAsk,
  memberWithTurn,
  pieceRun,
  requestStartedTurn,
  toolHarness,
  type MemberTurn,
} from './outpost-tool-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let web: MemberTurn;
let api: MemberTurn;

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t, 'Orders launch');
  web = await memberWithTurn(t, outpostId, 'web');
  api = await memberWithTurn(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

type Turn = Pick<MemberTurn, 'conversationId' | 'runId'>;

function read(turn: Turn, args: Record<string, unknown> = {}) {
  return outpostTool.run(args, toolHarness(t, turn).context) as Promise<Record<string, unknown>>;
}

async function pinnedNote(body: string): Promise<void> {
  const [post] = await insertPosts(t.db, [
    { id: randomUUID(), outpostId, kind: 'note', body, fromUser: true },
  ]);
  await t.db.query('UPDATE outpost_posts SET pinned_at = now() WHERE id = $1', [post!.id]);
}

describe('spark_outpost', () => {
  it('shows the room: members, pinned notes, open requests and the latest posts, as quoted data', async () => {
    await pinnedNote('The API contract is in docs/orders.md.');
    const open = await chatAsk(t, outpostId, api, web, false);
    const done = await chatAsk(t, outpostId, web, api, false);
    await carry(t, done, api.runId);
    await finishRun(t.db, api.runId, 'succeeded', 'A list.');
    const room = await read(web);
    expect(room.untrusted).toBeTruthy();
    expect(room.outpost).toEqual({ id: outpostId, name: 'Orders launch', paused: false });
    expect(room.members).toEqual([
      expect.objectContaining({ handle: '@web', chat: web.conversationId, you: true }),
      expect.objectContaining({ handle: '@api', chat: api.conversationId }),
    ]);
    expect(room.pinnedNotes).toEqual([
      expect.objectContaining({ from: 'user', text: 'The API contract is in docs/orders.md.' }),
    ]);
    expect(room.openRequests).toEqual([
      expect.objectContaining({ post: open, from: '@api', to: '@web', state: 'sent' }),
    ]);
    expect(room.posts).toMatchObject({ total: 3 });
    expect(room.stories).toEqual([]);
  });

  it('is a read of other chats’ work', () => {
    expect(outpostTool.privateData).toBe(true);
    expect(outpostTool.acts).toBeUndefined();
    expect(outpostTool.needs).toBe('outpost');
  });

  it('returns a finished request’s answer once to the chat that asked, with its read labels', async () => {
    const postId = await chatAsk(t, outpostId, web, api, false);
    await t.db.query(
      `INSERT INTO run_observations (id, run_id, conversation_id, source, label)
       VALUES (gen_random_uuid(), $1, $2, 'secret_file', 'secret file .env')`,
      [api.runId, api.conversationId],
    );
    await carry(t, postId, api.runId);
    await finishRun(t.db, api.runId, 'succeeded', 'It returns a list of orders.');
    const shown = await read(web, { request: postId });
    expect(shown).toMatchObject({
      request: postId,
      from: '@web',
      to: '@api',
      state: 'answered',
      answer: 'It returns a list of orders.',
      text: 'Question for @api',
    });
    expect(shown.untrusted).toBeTruthy();
    expect((await getPost(t.db, postId))!.post.answerSeenAt).not.toBeNull();
    expect(await turnObservations(t.db, web.runId)).toEqual(
      expect.arrayContaining([
        { source: 'private_data', label: 'private work data (outpost answer)' },
        { source: 'secret_file', label: 'secret file .env' },
      ]),
    );
  });

  it('leaves a request another chat sent unseen for its own sender', async () => {
    const docs = await memberWithTurn(t, outpostId, 'docs');
    const postId = await chatAsk(t, outpostId, docs, api, false);
    await carry(t, postId, api.runId);
    await finishRun(t.db, api.runId, 'succeeded', 'Done.');
    expect(await read(web, { request: postId })).toMatchObject({ state: 'answered' });
    expect((await getPost(t.db, postId))!.post.answerSeenAt).toBeNull();
  });

  it('shows a request that is still open without an answer', async () => {
    const postId = await chatAsk(t, outpostId, web, api, false);
    const shown = await read(web, { request: postId });
    expect(shown).toMatchObject({ state: 'sent' });
    expect(shown.answer).toBeUndefined();
    expect((await getPost(t.db, postId))!.post.answerSeenAt).toBeNull();
  });

  it('refuses a request of another outpost', async () => {
    const other = await createOutpostRow(t, 'Billing');
    const ops = await addMemberChat(t, other, 'ops');
    const [post] = await insertPosts(t.db, [userRequest(other, ops, 'ops')]);
    await expect(read(web, { request: post!.id })).rejects.toThrow(REQUEST_NOT_HERE);
  });

  it('refuses a piece of a member chat and a chat that is in no outpost', async () => {
    const piece = { conversationId: web.conversationId, runId: await pieceRun(t, web.runId) };
    await expect(read(piece)).rejects.toThrow(NOT_FOR_PIECES);
    await expect(read(await startChat(t, 'elsewhere'))).rejects.toThrow(NOT_IN_OUTPOST);
  });
});

describe('spark_outpost_note', () => {
  function note(turn: Turn, text: string) {
    const harness = toolHarness(t, turn);
    const result = outpostNoteTool.run({ text }, harness.context) as Promise<{ post: string }>;
    return { harness, result };
  }

  it('posts a note from the chat and audits it without the text', async () => {
    const { harness, result } = note(web, 'Orders are paged, 50 a page.');
    const { post } = await result;
    expect((await getPost(t.db, post))!.post).toMatchObject({
      kind: 'note',
      body: 'Orders are paged, 50 a page.',
      fromUser: false,
      fromConversationId: web.conversationId,
      fromHandle: 'web',
      fromRunId: web.runId,
      toConversationId: null,
    });
    expect(harness.audited.map((entry) => entry.method)).toEqual(['spark/outpost_note']);
    expect(harness.audited[0]!.params).toMatchObject({ postId: post, outpostId, textLength: 28 });
    expect(JSON.stringify(harness.audited)).not.toContain('paged');
  });

  it('lets a turn another chat’s request started leave a note', async () => {
    const docs = { conversationId: await addMemberChat(t, outpostId, 'docs'), handle: 'docs' };
    const turn = await requestStartedTurn(t, outpostId, docs, 'chat', web);
    const { post } = await note(turn, 'The docs page is drafted.').result;
    expect((await getPost(t.db, post))!.post.kind).toBe('note');
  });

  it('refuses text that addresses a chat, so a note never starts work', async () => {
    await expect(note(web, '@api add the endpoint').result).rejects.toThrow(NOTE_IS_ADDRESSED);
    await expect(note(web, '@all stop').result).rejects.toThrow(NOTE_IS_ADDRESSED);
    expect(await listPosts(t.db, outpostId)).toHaveLength(0);
  });

  it('refuses a chat that is in no outpost', async () => {
    await expect(note(await startChat(t, 'elsewhere'), 'hello').result).rejects.toThrow(
      NOT_IN_OUTPOST,
    );
  });

  it('is not an action tool', () => {
    expect(outpostNoteTool.acts).toBeUndefined();
    expect(outpostNoteTool.needs).toBe('outpost');
  });
});
