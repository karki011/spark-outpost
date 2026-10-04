import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  faceFromName,
  type Teammate,
  type TeammateChat,
  type TeammateList,
} from '@spark-outpost/contracts';
import { createProject } from '../src/projects/projects.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let client: ReturnType<typeof localClient>;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  client = localClient(createTestApp(t));
  await connectCliProvider(t, 'claude');
  root = await mkdtemp(path.join(tmpdir(), 'spark-teammates-'));
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

async function create(body: Record<string, unknown>): Promise<Teammate> {
  const response = await client.send('post', '/api/teammates', body);
  expect(response.status).toBe(201);
  return response.body as Teammate;
}

async function list(): Promise<TeammateList> {
  return (await client.get('/api/teammates')).body as TeammateList;
}

async function talkTo(conversationId: string, teammateId: string | null): Promise<TeammateChat> {
  const response = await client.send('put', `/api/conversations/${conversationId}/teammate`, {
    teammateId,
  });
  expect(response.status).toBe(200);
  return response.body as TeammateChat;
}

describe('teammate CRUD', () => {
  it('creates, lists, updates and deletes a Spark with a face from its name', async () => {
    const created = await create({ name: 'Pip', role: 'Code reviewer' });
    expect(created).toMatchObject({ name: 'Pip', role: 'Code reviewer', homeConversationId: null });
    expect(created.face.shape).toBeTruthy();

    const listed = await list();
    expect(listed.teammates.map((teammate) => [teammate.name, teammate.state])).toEqual([
      ['Pip', 'idle'],
    ]);
    expect(listed.starters).toEqual(['wren', 'bolt']);

    const updated = await client.send('patch', `/api/teammates/${created.id}`, {
      role: 'Reviewer',
      face: { shape: 'sun', color: 'gold' },
      instructions: 'Be brief.',
    });
    expect(updated.body).toMatchObject({
      role: 'Reviewer',
      face: { shape: 'sun', color: 'gold' },
      instructions: 'Be brief.',
    });

    expect((await client.send('delete', `/api/teammates/${created.id}`)).status).toBe(204);
    expect((await list()).teammates).toEqual([]);
    expect((await client.send('delete', `/api/teammates/${created.id}`)).status).toBe(404);
  });

  it('keeps the blob on the name until a look is picked, and goes back on null', async () => {
    const created = await create({ name: 'Pip' });
    expect(created).toMatchObject({ faceAuto: true, face: faceFromName('Pip') });

    const renamed = await client.send('patch', `/api/teammates/${created.id}`, { name: 'Wren' });
    expect(renamed.body).toMatchObject({ faceAuto: true, face: faceFromName('Wren') });

    const picked = await client.send('patch', `/api/teammates/${created.id}`, {
      face: { shape: 'sun', color: 'gold' },
    });
    expect(picked.body).toMatchObject({ faceAuto: false, face: { shape: 'sun', color: 'gold' } });
    const kept = await client.send('patch', `/api/teammates/${created.id}`, { name: 'Ada' });
    expect(kept.body).toMatchObject({ faceAuto: false, face: { shape: 'sun', color: 'gold' } });

    const reset = await client.send('patch', `/api/teammates/${created.id}`, { face: null });
    expect(reset.body).toMatchObject({ faceAuto: true, face: faceFromName('Ada') });

    const explicit = await create({ name: 'Bolt', face: { shape: 'boxy', color: 'ember' } });
    expect(explicit).toMatchObject({ faceAuto: false, face: { shape: 'boxy', color: 'ember' } });
  });

  it('shows the same name-based blob on the roster and on the chat', async () => {
    const teammate = await create({ name: 'Juniper' });
    const opened = await client.send('post', `/api/teammates/${teammate.id}/home`, {});
    const chat = opened.body as TeammateChat;
    expect(chat.teammate?.face).toEqual(faceFromName('Juniper'));
    const detail = await getConversationDetail(t.db, chat.conversationId);
    expect(detail?.conversation.teammate?.face).toEqual(faceFromName('Juniper'));
  });

  it('stores an instructions file path only for a readable text file', async () => {
    const role = path.join(root, 'reviewer.md');
    await writeFile(role, 'Name the file and line.');
    await writeFile(path.join(root, '.env'), 'TOKEN=abc');
    const created = await create({ name: 'Pip', instructionsPath: role, instructions: 'Typed.' });
    expect(created).toMatchObject({ instructionsPath: role, instructions: 'Typed.' });

    const preview = await client.get(`/api/instructions-file?path=${encodeURIComponent(role)}`);
    expect(preview.body).toMatchObject({
      name: 'reviewer.md',
      text: 'Name the file and line.',
      truncated: false,
      problem: null,
    });

    for (const [bad, message] of [
      [path.join(root, '.env'), 'Secret files can’t be used as instructions.'],
      [path.join(root, 'gone.md'), 'This file is missing.'],
      ['roles/reviewer.md', 'Choose a file by its full path.'],
    ] as const) {
      const refused = await client.send('patch', `/api/teammates/${created.id}`, {
        instructionsPath: bad,
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe(message);
    }
    const secret = await client.get(
      `/api/instructions-file?path=${encodeURIComponent(path.join(root, '.env'))}`,
    );
    expect(secret.body).toMatchObject({ text: '', problem: expect.stringContaining('Secret') });

    const cleared = await client.send('patch', `/api/teammates/${created.id}`, {
      instructionsPath: null,
    });
    expect(cleared.body).toMatchObject({ instructionsPath: null, instructions: 'Typed.' });
  });

  it('refuses duplicate names, long instructions and unconnected providers', async () => {
    await create({ name: 'Wren' });
    const duplicate = await client.send('post', '/api/teammates', { name: 'wren' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('You already have a Spark named wren.');

    const long = await client.send('post', '/api/teammates', {
      name: 'Bolt',
      instructions: 'x'.repeat(2001),
    });
    expect(long.status).toBe(400);
    expect(long.body.error).toContain('2000');

    const codex = await client.send('post', '/api/teammates', { name: 'Ada', provider: 'codex' });
    expect(codex.status).toBe(400);
  });

  it('hides a starter once it is dismissed', async () => {
    const dismissed = await client.send('post', '/api/teammate-starters/wren/dismiss');
    expect(dismissed.status).toBe(204);
    expect((await list()).starters).toEqual(['pip', 'bolt']);
  });
});

describe('chats with a teammate', () => {
  it('starts a chat with the teammate’s provider, model, mode, autonomy and projects', async () => {
    const { project } = await createProject(t.db, t.workspaceId, root);
    const teammate = await create({
      name: 'Bolt',
      provider: 'claude',
      model: 'opus',
      agentMode: 'plan',
      level: 'full-auto',
      projectIds: [project.id],
    });
    const conversationId = randomUUID();

    const linked = await talkTo(conversationId, teammate.id);

    expect(linked.teammate).toMatchObject({ id: teammate.id, name: 'Bolt' });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.settings).toMatchObject({
      provider: 'claude',
      model: 'opus',
      agentMode: 'plan',
      level: 'full-auto',
    });
    expect(detail?.conversation.projectIds).toEqual([project.id]);
    expect(detail?.conversation.teammate).toMatchObject({ name: 'Bolt', face: teammate.face });

    await talkTo(conversationId, null);
    const plain = await getConversationDetail(t.db, conversationId);
    expect(plain?.conversation.teammate).toBeNull();
    expect(plain?.conversation.projectIds).toEqual([]);
    expect(plain?.settings.model).not.toBe('opus');
  });

  it('only links a chat before its first message', async () => {
    const teammate = await create({ name: 'Pip' });
    const { conversationId } = await startChat(t, 'hello');
    const response = await client.send('put', `/api/conversations/${conversationId}/teammate`, {
      teammateId: teammate.id,
    });
    expect(response.status).toBe(409);
  });

  it('opens one home thread per teammate, named after it', async () => {
    const teammate = await create({ name: 'Wren', level: 'full-auto' });
    const first = await client.send('post', `/api/teammates/${teammate.id}/home`);
    const again = await client.send('post', `/api/teammates/${teammate.id}/home`);

    expect(first.body.conversationId).toBe(again.body.conversationId);
    const detail = await getConversationDetail(t.db, first.body.conversationId as string);
    expect(detail?.conversation).toMatchObject({ title: 'Wren', titleSource: 'user' });
    expect(detail?.settings.level).toBe('full-auto');
    expect((await list()).teammates[0]?.homeConversationId).toBe(first.body.conversationId);
  });

  it('unlinks its chats when a teammate is deleted, keeping the chats', async () => {
    const teammate = await create({ name: 'Pip' });
    const home = await client.send('post', `/api/teammates/${teammate.id}/home`);
    const conversationId = home.body.conversationId as string;
    await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'Review my branch' },
      { provider: 'fake' },
    );

    await client.send('delete', `/api/teammates/${teammate.id}`);

    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.conversation.teammate).toBeNull();
    expect(detail?.messages.map((message) => message.content)).toEqual(['Review my branch']);
  });
});

describe('teammate state across chats', () => {
  async function chatWith(teammateId: string, content: string) {
    const conversationId = randomUUID();
    await talkTo(conversationId, teammateId);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content },
      { provider: 'fake' },
    );
    return { conversationId, runId: sent.run.id };
  }

  const stateOf = async (name: string) =>
    (await list()).teammates.find((teammate) => teammate.name === name);

  it('aggregates working, needs you, done and failed from the teammate’s chats', async () => {
    const teammate = await create({ name: 'Bolt' });
    const first = await chatWith(teammate.id, 'Fix the crash');
    expect(await stateOf('Bolt')).toMatchObject({
      state: 'working',
      chatCount: 1,
      lastActivity: { conversationId: first.conversationId, title: 'Fix the crash' },
    });

    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [first.runId]);
    await insertApproval(t.db, {
      runId: first.runId,
      toolCallId: 'call-1',
      rpcId: null,
      kind: 'execute',
      title: 'rm -rf build',
      payload: { command: 'rm -rf build', cwd: null, paths: [], diffs: [], truncated: false },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      reason: null,
    });
    expect((await stateOf('Bolt'))?.state).toBe('needs_you');

    await t.db.query(
      `UPDATE approvals SET status = 'allowed', decided_at = now() WHERE run_id = $1`,
      [first.runId],
    );
    await t.db.query(
      `UPDATE runs SET status = 'succeeded', finished_at = now() - interval '5 minutes'
       WHERE id = $1`,
      [first.runId],
    );
    expect((await stateOf('Bolt'))?.state).toBe('done');

    const second = await chatWith(teammate.id, 'Try the other fix');
    await t.db.query(
      `UPDATE runs SET status = 'failed', finished_at = now(), error = 'boom' WHERE id = $1`,
      [second.runId],
    );
    expect(await stateOf('Bolt')).toMatchObject({ state: 'failed', chatCount: 2 });

    await t.db.query(
      `UPDATE runs SET finished_at = now() - interval '2 days' WHERE conversation_id IN ($1, $2)`,
      [first.conversationId, second.conversationId],
    );
    expect((await stateOf('Bolt'))?.state).toBe('idle');
  });

  it('keeps other teammates idle', async () => {
    const busy = await create({ name: 'Bolt' });
    await create({ name: 'Wren' });
    await chatWith(busy.id, 'Fix it');
    expect((await stateOf('Wren'))?.state).toBe('idle');
  });
});
