import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const list = async () =>
  (await request(app).get('/api/conversations').set('Host', HOST).expect(200))
    .body as ConversationSummary[];
const pin = (id: string, pinned: boolean) =>
  request(app).patch(`/api/conversations/${id}`).set('Host', HOST).send({ pinned }).expect(200);
const order = (conversationIds: unknown) =>
  request(app)
    .put('/api/conversations/pinned-order')
    .set('Host', HOST)
    .set('Origin', ORIGIN)
    .send({ conversationIds });

async function chat(content: string): Promise<string> {
  const id = randomUUID();
  await sendUserMessage(
    t.db,
    id,
    { id: randomUUID(), content },
    { provider: 'fake' },
    t.workspaceId,
  );
  return id;
}

async function pinnedOrders(): Promise<Record<string, number | null>> {
  return Object.fromEntries((await list()).map((entry) => [entry.title, entry.pinnedOrder]));
}

describe('pinned order', () => {
  it('stores a manual order for pinned chats and clears it on unpin', async () => {
    const [first, second, loose] = [await chat('First'), await chat('Second'), await chat('Loose')];
    await pin(first, true);
    await pin(second, true);
    expect(await pinnedOrders()).toEqual({ First: null, Second: null, Loose: null });

    await order([first, second, loose]).expect(204);
    expect(await pinnedOrders()).toEqual({ First: 1, Second: 2, Loose: null });

    await order([second, first]).expect(204);
    expect(await pinnedOrders()).toEqual({ First: 2, Second: 1, Loose: null });

    await pin(first, false);
    await pin(first, true);
    expect(await pinnedOrders()).toEqual({ First: null, Second: 1, Loose: null });
  });

  it('rejects empty and malformed lists and ignores unknown chats', async () => {
    await order([]).expect(400);
    await order(['nope']).expect(400);
    await order('x').expect(400);
    await order([randomUUID()]).expect(204);
  });
});
