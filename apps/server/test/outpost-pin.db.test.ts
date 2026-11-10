import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outpostDetailSchema, type OutpostDetail } from '@spark-outpost/contracts';
import {
  ONLY_NOTES_PIN,
  outpostErrorStatus,
  outpostRoutes,
  POST_NOT_FOUND,
} from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import { addMemberChat, createOutpostRow, insertRequestRow } from './outpost-fixtures.ts';
import { outpostEvents } from './outpost-store-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let app: express.Express;
let outpostId: string;

beforeEach(async () => {
  t = await createTestDb();
  app = express();
  app.use(express.json());
  app.use(
    '/api',
    outpostRoutes({
      db: t.db,
      workspaceId: t.workspaceId,
      peer: fakePeerAgent({}),
      drain: async () => undefined,
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const { status, message } = outpostErrorStatus(error) ?? statusForError(error);
      res.status(status).json({ error: message });
    },
  );
  outpostId = await createOutpostRow(t);
});

afterEach(async () => {
  await t.cleanup();
});

async function note(text: string, author: 'user' | 'chat' = 'user'): Promise<string> {
  const id = randomUUID();
  const from = author === 'chat' ? await addMemberChat(t, outpostId, 'api') : null;
  await t.db.query(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, from_conversation_id, from_handle)
     VALUES ($1, $2, 'note', $3, $4, $5, $6)`,
    [id, outpostId, text, author === 'user', from, from ? 'api' : null],
  );
  return id;
}

function pin(postId: string, pinned: boolean, outpost = outpostId) {
  return request(app).post(`/api/outposts/${outpost}/posts/${postId}/pin`).send({ pinned });
}

function pinnedAt(detail: OutpostDetail, postId: string): string | null | undefined {
  return detail.posts.find((each) => each.id === postId)?.pinnedAt;
}

describe('pinning a note', () => {
  it('pins and unpins a note and returns the outpost with the mark', async () => {
    const id = await note('Ship Friday.');

    const pinned = await pin(id, true);
    expect(pinned.status).toBe(200);
    expect(pinnedAt(outpostDetailSchema.parse(pinned.body), id)).toEqual(expect.any(String));

    const again = await pin(id, true);
    expect(pinnedAt(outpostDetailSchema.parse(again.body), id)).toBe(
      pinnedAt(outpostDetailSchema.parse(pinned.body), id),
    );

    const unpinned = await pin(id, false);
    expect(pinnedAt(outpostDetailSchema.parse(unpinned.body), id)).toBeNull();
  });

  it('pins a note a chat wrote only because the user asked, and tells the app', async () => {
    const id = await note('Plan is in docs.', 'chat');
    const events = await outpostEvents();
    try {
      expect((await pin(id, true)).status).toBe(200);
      await eventually(() => expect(events.seen).toContain(outpostId));
    } finally {
      await events.close();
    }
  });

  it('refuses a request, an unknown post and a post of another outpost', async () => {
    const chat = await addMemberChat(t, outpostId, 'api');
    const requestId = await insertRequestRow(t.db, {
      outpostId,
      toConversationId: chat,
      toHandle: 'api',
    });
    const other = await createOutpostRow(t, 'Other');
    const stranger = await note('Elsewhere.');

    const refusedRequest = await pin(requestId, true);
    expect(refusedRequest.status).toBe(409);
    expect(refusedRequest.body).toEqual({ error: ONLY_NOTES_PIN });
    for (const response of [await pin(randomUUID(), true), await pin(stranger, true, other)]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: POST_NOT_FOUND });
    }
    expect((await pin(stranger, 'yes' as unknown as boolean)).status).toBe(400);
  });
});
