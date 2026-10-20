import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOutpostResponseSchema, runSchema } from '@spark-outpost/contracts';
import { attachmentsForMessages, saveAttachment } from '../src/persistence/attachments.ts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import { listConversations } from '../src/persistence/conversations.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
import { OUTPOST_REQUEST_METHOD } from '../src/outposts/request-audit.ts';
import { chatTurns } from './outpost-fixtures.ts';
import {
  gate,
  openRoom,
  post,
  readRoom,
  shown,
  startStack,
  type Room,
  type Stack,
} from './outposts-e2e-support.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let stacks: Stack[];

beforeEach(async () => {
  t = await createTestDb();
  stacks = [];
});

afterEach(async () => {
  for (const stack of stacks) await stack.stop();
  await t.cleanup();
});

async function start(options?: Parameters<typeof startStack>[1]): Promise<Stack> {
  const stack = await startStack(t, options);
  stacks.push(stack);
  return stack;
}

async function stop(stack: Stack): Promise<void> {
  stacks = stacks.filter((running) => running !== stack);
  await stack.stop();
}

function reaches(stack: Stack, room: Room, postId: string, state: string) {
  return eventually(async () => {
    const found = await shown(stack, room.outpostId, postId);
    return found.state === state ? found : null;
  });
}

async function auditEntries(runId: string) {
  const { rows } = await t.db.query<{ direction: string; payload: { params: object } }>(
    'SELECT direction, payload FROM run_protocol_log WHERE run_id = $1 AND method = $2',
    [runId, OUTPOST_REQUEST_METHOD],
  );
  return rows;
}

describe('a request the user posts in an outpost', () => {
  it('goes Sent, Working, then Answered with the answer under it', async () => {
    const held = gate();
    const stack = await start({ held: held.opened });
    const room = await openRoom(stack);

    const request = await post(stack, room.outpostId, '@api list the order fields');
    expect(request).toMatchObject({ kind: 'request', toHandle: 'api', state: 'sent' });

    const working = await reaches(stack, room, request.id, 'working');
    expect(working.answer).toBeNull();
    expect(working.taskId).not.toBeNull();
    held.open();

    const answered = await reaches(stack, room, request.id, 'answered');
    expect(answered.answer?.text).toContain('list the order fields');
    expect(answered.runId).toBe(working.runId);
    expect(await chatTurns(t.db, room.api)).toMatchObject([
      { id: answered.runId, source: 'outpost', status: 'succeeded', user_message_id: request.id },
    ]);
    expect(await chatTurns(t.db, room.web)).toEqual([]);
  });

  it('tells the page each time the request moves', async () => {
    const held = gate();
    const stack = await start({ held: held.opened });
    const room = await openRoom(stack);
    const request = await post(stack, room.outpostId, '@api list the order fields');
    await reaches(stack, room, request.id, 'working');
    const before = stack.changed.length;

    held.open();
    await reaches(stack, room, request.id, 'answered');

    await eventually(async () => stack.changed.slice(before).includes(room.outpostId));
  });

  it('records the request on the receiving run without its text, and names the outpost on the run', async () => {
    const stack = await start();
    const room = await openRoom(stack);
    const request = await post(stack, room.outpostId, '@api list the order fields');
    const answered = await reaches(stack, room, request.id, 'answered');
    const runId = answered.runId!;

    const entries = await auditEntries(runId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.direction).toBe('harness');
    expect(entries[0]?.payload.params).toMatchObject({
      postId: request.id,
      taskId: answered.taskId,
      outpostId: room.outpostId,
      fromUser: true,
      fromConversationId: null,
      toConversationId: room.api,
      textLength: request.body.length,
    });
    expect(JSON.stringify(entries[0]?.payload)).not.toContain('order fields');

    const run = runSchema.parse((await stack.get(`/api/runs/${runId}`).expect(200)).body);
    expect(run.outpost).toMatchObject({
      postId: request.id,
      outpostId: room.outpostId,
      outpostName: 'Orders launch',
      fromUser: true,
    });
  });

  it('starts nothing for a note', async () => {
    const stack = await start();
    const room = await openRoom(stack);
    const request = await post(stack, room.outpostId, '@web name the page');
    const note = await post(stack, room.outpostId, 'The launch is on Friday.');
    await reaches(stack, room, request.id, 'answered');

    expect(note).toMatchObject({ kind: 'note', state: null, taskId: null, runId: null });
    expect(await shown(stack, room.outpostId, note.id)).toMatchObject({ state: null, runId: null });
    expect(await chatTurns(t.db, room.api)).toEqual([]);
    expect(await chatTurns(t.db, room.web)).toHaveLength(1);
  });
});

describe('pause and resume', () => {
  it('holds a request while the outpost is paused and starts it on resume', async () => {
    const stack = await start();
    const room = await openRoom(stack);
    await stack.send('patch', `/api/outposts/${room.outpostId}`, { paused: true }).expect(200);

    const request = await post(stack, room.outpostId, '@api list the order fields');
    const note = await post(stack, room.outpostId, 'Paused for the deploy.');
    await eventually(async () => stack.changed.includes(room.outpostId));
    expect(note.kind).toBe('note');
    expect(await shown(stack, room.outpostId, request.id)).toMatchObject({
      state: 'sent',
      reason: 'Paused',
      taskId: null,
    });
    expect(await chatTurns(t.db, room.api)).toEqual([]);

    await stack.send('patch', `/api/outposts/${room.outpostId}`, { paused: false }).expect(200);

    await reaches(stack, room, request.id, 'answered');
    expect(await chatTurns(t.db, room.api)).toHaveLength(1);
  });
});

describe('cancelling a request that is still queued', () => {
  it('closes it from the outpost and never starts its turn', async () => {
    const held = gate();
    const stack = await start({ held: held.opened });
    const room = await openRoom(stack);
    const first = await post(stack, room.outpostId, '@api list the order fields');
    await reaches(stack, room, first.id, 'working');
    const second = await post(stack, room.outpostId, '@api and the refund fields');
    await eventually(async () => (await shown(stack, room.outpostId, second.id)).taskId !== null);

    await stack
      .send('post', `/api/outposts/${room.outpostId}/posts/${second.id}/cancel`)
      .expect(200);
    held.open();

    await reaches(stack, room, first.id, 'answered');
    expect(await shown(stack, room.outpostId, second.id)).toMatchObject({
      state: 'cancelled',
      runId: null,
    });
    expect(await chatTurns(t.db, room.api)).toHaveLength(1);
  });

  it('closes it when the user removes it from the chat’s queue', async () => {
    const held = gate();
    const stack = await start({ held: held.opened });
    const room = await openRoom(stack);
    const first = await post(stack, room.outpostId, '@api list the order fields');
    await reaches(stack, room, first.id, 'working');
    const second = await post(stack, room.outpostId, '@api and the refund fields');
    await eventually(async () => (await shown(stack, room.outpostId, second.id)).taskId !== null);
    const before = stack.changed.length;

    const removed = await stack
      .send('delete', `/api/conversations/${room.api}/queue/${second.id}`)
      .expect(200);

    expect(removed.body).toEqual({ queue: [] });
    expect(await shown(stack, room.outpostId, second.id)).toMatchObject({ state: 'cancelled' });
    await eventually(async () => stack.changed.slice(before).includes(room.outpostId));
    held.open();
    await reaches(stack, room, first.id, 'answered');
    expect(await chatTurns(t.db, room.api)).toHaveLength(1);
  });
});

describe('cancelling a request that is working', () => {
  it('stops its turn, and the next request the user posts to that chat starts', async () => {
    const held = gate();
    const stack = await start({ held: held.opened });
    const room = await openRoom(stack);
    const first = await post(stack, room.outpostId, '@api list the order fields');
    await reaches(stack, room, first.id, 'working');

    await stack
      .send('post', `/api/outposts/${room.outpostId}/posts/${first.id}/cancel`)
      .expect(200);
    await reaches(stack, room, first.id, 'cancelled');
    held.open();
    const second = await post(stack, room.outpostId, '@api and the refund fields');

    await reaches(stack, room, second.id, 'answered');
    expect(await chatTurns(t.db, room.api)).toMatchObject([
      { status: 'cancelled' },
      { status: 'succeeded', user_message_id: second.id },
    ]);
  });
});

describe('a restart', () => {
  it('sends a request that was written but not sent, once', async () => {
    const stopped = await start({ dispatch: false });
    const room = await openRoom(stopped);
    const request = await post(stopped, room.outpostId, '@api list the order fields');
    expect(await shown(stopped, room.outpostId, request.id)).toMatchObject({
      state: 'sent',
      reason: 'Not sent yet',
      taskId: null,
    });
    await stop(stopped);

    const restarted = await start();
    const answered = await reaches(restarted, room, request.id, 'answered');
    await post(restarted, room.outpostId, 'A note that wakes the dispatcher again.');
    await stop(restarted);

    const again = await start();
    const note = await post(again, room.outpostId, 'Another note.');
    await eventually(async () => again.changed.includes(room.outpostId));

    expect(note.kind).toBe('note');
    expect(await shown(again, room.outpostId, request.id)).toMatchObject({
      state: 'answered',
      taskId: answered.taskId,
      runId: answered.runId,
    });
    expect(await chatTurns(t.db, room.api)).toHaveLength(1);
    expect((await readRoom(again, room.outpostId)).posts.filter((each) => each.state)).toHaveLength(
      1,
    );
  });
});

describe('an outpost started with a new chat and a first message', () => {
  it('creates the chat, sends the message with its file, and shows the answer', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-outpost-start-')));
    const { project } = await createProject(t.db, t.workspaceId, root);
    await connectCliProvider(t, 'codex');
    await saveCapabilities(t.db, t.workspaceId, {
      provider: 'codex',
      models: [],
      efforts: [],
      defaultModel: null,
      modes: FAKE_CODEX_MODES,
    });
    const file = await saveAttachment(t.db, t.workspaceId, {
      name: 'usage-contract.md',
      mediaType: 'text/markdown',
      data: Buffer.from('# Contract'),
    });
    const held = gate();
    const stack = await start({ held: held.opened });
    const ids = {
      outpost: randomUUID(),
      chat: randomUUID(),
      empty: randomUUID(),
      message: randomUUID(),
    };
    const newChat = (conversationId: string) => ({
      conversationId,
      projectId: project.id,
      provider: 'codex',
      model: null,
      agentMode: null,
    });
    const body = {
      id: ids.outpost,
      name: 'Usage by user',
      members: [
        {
          new: newChat(ids.chat),
          handle: 'api',
          firstMessage: { id: ids.message, text: 'Follow the contract', attachmentIds: [file.id] },
        },
        { new: newChat(ids.empty), handle: 'docs' },
      ],
    };

    const response = await stack.send('post', '/api/outposts', body).expect(201);
    const created = createOutpostResponseSchema.parse(response.body);
    const room = { outpostId: ids.outpost, api: ids.chat, web: ids.empty };

    expect(created.failed).toEqual([]);
    expect(created.posts.map((post) => [post.kind, post.body, post.intro?.task ?? null])).toEqual([
      [
        'notice',
        `@api joined · ${project.name} · Codex · Approve for me`,
        'Task: Follow the contract',
      ],
      ['notice', `@docs joined · ${project.name} · Codex · Approve for me`, null],
      ['request', 'Follow the contract', null],
    ]);
    expect(created.posts[2]).toMatchObject({ fromUser: true, toHandle: 'api', files: 1 });
    await reaches(stack, room, ids.message, 'working');
    held.open();
    const answered = await reaches(stack, room, ids.message, 'answered');
    expect(answered.answer?.text).toContain('Follow the contract');
    expect((await attachmentsForMessages(t.db, [ids.message])).get(ids.message)).toMatchObject([
      { name: 'usage-contract.md' },
    ]);
    expect(await chatTurns(t.db, ids.empty)).toEqual([]);
    const listed = (await listConversations(t.db, t.workspaceId)).map((chat) => chat.id);
    expect(listed.sort()).toEqual([ids.chat, ids.empty].sort());

    const repeated = await stack.send('post', '/api/outposts', body).expect(200);
    expect(createOutpostResponseSchema.parse(repeated.body).posts).toHaveLength(3);
    await rm(root, { recursive: true, force: true });
  });
});
