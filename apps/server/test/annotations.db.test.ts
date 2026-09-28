import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { annotationListSchema } from '@spark-outpost/contracts';
import { AnnotationError, listAnnotations } from '../src/persistence/annotations.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { createTestApp, HOST, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const target = { provider: 'fake' };

function comment(sourceMessageId: string, note = 'Why this order?') {
  return {
    id: randomUUID(),
    sourceMessageId,
    kind: 'comment' as const,
    quote: 'run the migration first',
    note,
    anchor: {
      exact: 'run the migration first',
      prefix: 'Then ',
      suffix: ', then deploy',
      start: 5,
      end: 28,
    },
  };
}

async function chatWithMessage() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const first = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Then run the migration first, then deploy' },
    target,
  );
  return { conversationId: conversation.id, sourceId: first.message.id };
}

describe('message annotations', () => {
  it('saves annotations with the message that carries them', async () => {
    const { conversationId, sourceId } = await chatWithMessage();
    const annotation = comment(sourceId);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      {
        id: randomUUID(),
        content: '> run the migration first\n\nWhy this order?',
        annotations: [annotation],
      },
      target,
    );

    const saved = await listAnnotations(t.db, conversationId);
    expect(saved).toEqual([
      {
        ...annotation,
        conversationId,
        messageId: sent.message.id,
        createdAt: expect.any(String),
      },
    ]);
  });

  it('rejects a quote from another chat and keeps the message unsent', async () => {
    const other = await chatWithMessage();
    const { conversationId } = await chatWithMessage();
    const messageId = randomUUID();

    await expect(
      sendUserMessage(
        t.db,
        conversationId,
        { id: messageId, content: 'About that', annotations: [comment(other.sourceId)] },
        target,
      ),
    ).rejects.toBeInstanceOf(AnnotationError);

    const message = await t.db.query('SELECT 1 FROM messages WHERE id = $1', [messageId]);
    expect(message.rowCount).toBe(0);
    expect(await listAnnotations(t.db, conversationId)).toEqual([]);
  });

  it('does not duplicate annotations when the same message is resent', async () => {
    const { conversationId, sourceId } = await chatWithMessage();
    const send = { id: randomUUID(), content: 'Resent', annotations: [comment(sourceId)] };

    await sendUserMessage(t.db, conversationId, send, target);
    await sendUserMessage(t.db, conversationId, send, target);

    expect(await listAnnotations(t.db, conversationId)).toHaveLength(1);
  });

  it('removes annotations with their chat', async () => {
    const { conversationId, sourceId } = await chatWithMessage();
    await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'Note', annotations: [comment(sourceId)] },
      target,
    );

    await t.db.query('DELETE FROM conversations WHERE id = $1', [conversationId]);

    const left = await t.db.query('SELECT 1 FROM message_annotations');
    expect(left.rowCount).toBe(0);
  });
});

describe('annotation API', () => {
  it('writes annotations with the message and lists them per chat', async () => {
    const app = createTestApp(t);
    const post = (path: string, body: object) =>
      request(app).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
    const conversationId = randomUUID();
    await post('/api/conversations', { id: conversationId }).expect(201);
    const first = await post(`/api/conversations/${conversationId}/messages`, {
      id: randomUUID(),
      content: 'Then run the migration first, then deploy',
    }).expect(201);
    const annotation = comment(first.body.message.id as string, '  Is this safe?  ');
    const sent = await post(`/api/conversations/${conversationId}/messages`, {
      id: randomUUID(),
      content: '> run the migration first\n\nIs this safe?',
      annotations: [annotation],
    }).expect(201);

    const listed = await request(app)
      .get(`/api/conversations/${conversationId}/annotations`)
      .set(LOCAL_HEADERS)
      .expect(200);

    const { annotations } = annotationListSchema.parse(listed.body);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      id: annotation.id,
      messageId: sent.body.message.id,
      note: 'Is this safe?',
      kind: 'comment',
    });
  });

  it('rejects invalid annotations', async () => {
    const app = createTestApp(t);
    const conversationId = randomUUID();
    await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({
        id: randomUUID(),
        content: 'Hi',
        annotations: [{ ...comment(randomUUID()), kind: 'shout' }],
      })
      .expect(400);
  });

  it('requires the launch token to list annotations', async () => {
    const app = createTestApp(t);
    await request(app)
      .get(`/api/conversations/${randomUUID()}/annotations`)
      .set('Host', HOST)
      .expect(401);
  });
});
