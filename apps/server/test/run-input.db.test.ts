import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { saveConnection, updateProfile } from '../src/persistence/setup.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const connectClaude = () =>
  saveConnection(t.db, t.workspaceId, 'claude', {
    method: 'cli',
    detail: 'claude 2.1.0',
    summary: '',
    models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }],
  });

describe('run input', () => {
  it('carries earlier turns and the provider settings, but not later messages', async () => {
    await connectClaude();
    const conversationId = randomUUID();
    await createConversation(t.db, t.workspaceId, conversationId);
    const first = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'My codename is Heron.' },
      { provider: 'claude' },
    );
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content, run_id)
       VALUES ($1, $2, 'assistant', 'Noted.', $3)`,
      [randomUUID(), conversationId, first.run.id],
    );
    const second = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'What is my codename?' },
      { provider: 'claude' },
    );
    await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'later' },
      { provider: 'claude' },
    );

    const input = await loadRunInput(t.db, second.run.id);
    expect(input.prompt).toBe('What is my codename?');
    expect(input.provider).toBe('claude');
    expect(input.history).toEqual([
      { role: 'user', content: 'My codename is Heron.' },
      { role: 'assistant', content: 'Noted.' },
    ]);
    expect(input.settings).toEqual({
      method: 'cli',
      model: 'claude-sonnet-5',
      modelLabel: 'Claude Sonnet 5',
      effort: null,
    });
  });
});

describe('choosing the provider for a new message', () => {
  it('refuses to queue a run until a provider is connected, then uses the default', async () => {
    const app = createTestApp(t, { fixedRunProvider: null });
    const post = (path: string, body: object) =>
      request(app).post(path).set('Host', HOST).set('Origin', ORIGIN).send(body);
    const conversationId = randomUUID();
    await post('/api/conversations', { id: conversationId }).expect(201);

    const refused = await post(`/api/conversations/${conversationId}/messages`, {
      id: randomUUID(),
      content: 'Hello',
    }).expect(400);
    expect(refused.body.error).toBe('Connect an AI provider before sending a message.');

    await connectClaude();
    await updateProfile(t.db, t.workspaceId, { defaultProvider: 'claude' });
    const sent = await post(`/api/conversations/${conversationId}/messages`, {
      id: randomUUID(),
      content: 'Hello',
    }).expect(201);
    expect(sent.body.run.provider).toBe('claude');
  });
});
