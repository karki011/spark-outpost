import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { migrationsDir } from '../src/persistence/migrate.ts';
import { createTestApp, localClient } from './app-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function routingOf(conversationId: string): Promise<string | undefined> {
  const { rows } = await t.db.query<{ model_routing: string }>(
    'SELECT model_routing FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.model_routing;
}

async function newChat(): Promise<string> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id);
  return id;
}

describe('model routing default', () => {
  it('starts a new chat on Auto and reports it in the chat settings', async () => {
    await connectCliProvider(t, 'claude');
    const id = await newChat();
    expect(await routingOf(id)).toBe('auto');
    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    const detail = await client.get(`/api/conversations/${id}`).expect(200);
    expect(detail.body.settings.routing).toBe('auto');
  });

  it('leaves chats made before the change pinned, and a pick still pins a new chat', async () => {
    await connectCliProvider(t, 'claude');
    await t.db.query(`ALTER TABLE conversations ALTER COLUMN model_routing SET DEFAULT 'pinned'`);
    const before = await newChat();
    const migration = await readFile(
      path.join(migrationsDir, '0143_auto_routing_default.sql'),
      'utf8',
    );
    await t.db.query(migration);
    const after = await newChat();
    expect(await routingOf(before)).toBe('pinned');
    expect(await routingOf(after)).toBe('auto');

    const client = localClient(createTestApp(t, { fixedRunProvider: null }));
    const picked = await client
      .send('patch', `/api/conversations/${after}/settings`, { model: 'opus', routing: 'pinned' })
      .expect(200);
    expect(picked.body.routing).toBe('pinned');
    expect(await routingOf(after)).toBe('pinned');
  });
});
