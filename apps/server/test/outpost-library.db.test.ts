import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chatDraftsSchema,
  outpostLibrarySchema,
  outpostSuggestionsSchema,
  type OutpostDraft,
} from '@spark-outpost/contracts';
import { outpostErrorStatus, outpostRoutes } from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import { listArtifactPages } from '../src/artifacts/store.ts';
import { insertChatFile, listChatFiles } from '../src/chat-files/store.ts';
import { markStarted, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import { addMemberChat, createOutpostRow } from './outpost-fixtures.ts';
import { chatWithTurn, newChat } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

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

async function memberWithTurn(handle: string): Promise<{ chat: string; runId: string }> {
  const turn = await chatWithTurn(t);
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     SELECT $1, $2, $3, COALESCE(MAX(position), 0) + 1 FROM outpost_members WHERE outpost_id = $1`,
    [outpostId, turn.conversationId, handle],
  );
  return { chat: turn.conversationId, runId: turn.runId };
}

async function addFile(chat: string, runId: string, path: string, size: number) {
  await insertChatFile(t.db, chat, runId, {
    id: randomUUID(),
    path,
    size,
    changedMs: 1,
    sha256: 'a'.repeat(64),
    mediaType: 'text/plain',
  });
}

async function addArtifact(chat: string, runId: string, titles: string[], published = true) {
  const id = randomUUID();
  await t.db.query(
    "INSERT INTO artifact_pages (id, conversation_id, kind) VALUES ($1, $2, 'html')",
    [id, chat],
  );
  for (const [index, title] of titles.entries()) {
    await t.db.query(
      `INSERT INTO artifact_page_versions
         (artifact_id, version, title, bytes, sha256, view_key, run_id, published_at)
       VALUES ($1, $2, $3, 10, $4, $5, $6, CASE WHEN $7 THEN now() END)`,
      [
        id,
        index + 1,
        title,
        'b'.repeat(64),
        randomUUID().replaceAll('-', '').repeat(2),
        runId,
        published,
      ],
    );
  }
}

describe('the outpost library read', () => {
  it('lists each member chat files and artifacts as the per-chat reads do', async () => {
    const api = await memberWithTurn('api');
    const web = await memberWithTurn('web');
    await addFile(api.chat, api.runId, '/work/b.txt', 20);
    await addFile(api.chat, api.runId, '/work/a.txt', 10);
    await addFile(web.chat, web.runId, '/work/c.png', 30);
    await addArtifact(api.chat, api.runId, ['Plan', 'Plan v2']);
    await addArtifact(web.chat, web.runId, ['Draft'], false);
    const outsider = await chatWithTurn(t);
    await addFile(outsider.conversationId, outsider.runId, '/work/x.txt', 1);

    const response = await request(app).get(`/api/outposts/${outpostId}/library`);

    expect(response.status).toBe(200);
    const { chats } = outpostLibrarySchema.parse(response.body);
    expect(chats.map((chat) => chat.conversationId)).toEqual([api.chat, web.chat]);
    for (const chat of chats) {
      const files = await listChatFiles(t.db, chat.conversationId);
      expect(chat.files).toEqual(
        files.map((file) => ({ id: file.id, name: file.name, size: file.size })),
      );
      const pages = await listArtifactPages(t.db, chat.conversationId);
      expect(chat.artifacts).toEqual(
        pages.map((page) => ({
          id: page.id,
          title: page.title,
          kind: page.kind,
          versions: page.versions.length,
        })),
      );
    }
    expect(chats[0]?.artifacts).toMatchObject([{ title: 'Plan v2', versions: 2 }]);
    expect(chats[1]?.artifacts).toEqual([]);
  });

  it('answers 404 for an outpost that does not exist', async () => {
    const response = await request(app).get(`/api/outposts/${randomUUID()}/library`);
    expect(response.status).toBe(404);
  });
});

const body: OutpostDraft = {
  title: 'Checkout',
  chats: [
    { handle: 'api', title: 'Orders endpoint', projectId: randomUUID(), task: 'Add the endpoint.' },
  ],
};

describe('the suggested threads read', () => {
  it('returns open drafts of every member in one request, as the per-chat reads show them', async () => {
    const lead = await memberWithTurn('lead');
    const other = await addMemberChat(t, outpostId, 'other');
    const outside = await newChat(t);
    const mine = randomUUID();
    const unattached = randomUUID();
    const started = randomUUID();
    const elsewhere = randomUUID();
    const draftFor = (id: string, conversationId: string, outpost: string | null) =>
      saveDraft(t.db, {
        id,
        workspaceId: t.workspaceId,
        conversationId,
        runId: null,
        outpostId: outpost,
        body,
      });
    await draftFor(mine, lead.chat, outpostId);
    await draftFor(unattached, other, null);
    await draftFor(started, lead.chat, null);
    await markStarted(t.db, started, outpostId);
    await draftFor(elsewhere, outside, null);
    await draftFor(randomUUID(), other, await createOutpostRow(t, 'Other'));

    const response = await request(app).get(`/api/outposts/${outpostId}/suggestions`);

    expect(response.status).toBe(200);
    const { drafts } = outpostSuggestionsSchema.parse(response.body);
    expect(drafts.map((draft) => draft.id).sort()).toEqual([mine, unattached].sort());
    const perChat = await Promise.all(
      [lead.chat, other].map(async (chat) => {
        const own = await request(app).get(`/api/conversations/${chat}/outpost-drafts`);
        return chatDraftsSchema
          .parse(own.body)
          .drafts.filter((draft) => draft.startedAt === null)
          .filter((draft) => draft.outpostId === null || draft.outpostId === outpostId)
          .map((draft) => ({ ...draft, conversationId: chat }));
      }),
    );
    expect(drafts).toEqual(expect.arrayContaining(perChat.flat()));
    expect(drafts).toHaveLength(perChat.flat().length);
  });
});
