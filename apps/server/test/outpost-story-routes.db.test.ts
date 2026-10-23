import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chatDraftsSchema,
  createOutpostResponseSchema,
  outpostDetailSchema,
  outpostSchema,
} from '@spark-outpost/contracts';
import {
  ONLY_REQUESTS_START,
  outpostErrorStatus,
  outpostRoutes,
  POST_NOT_FOUND,
} from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import { saveDraft } from '../src/persistence/outpost-drafts.ts';
import { heldRequests, unsentRequests } from '../src/persistence/outpost-posts.ts';
import type { StackGit } from '../src/outposts/ports.ts';
import { DRAFT_NOT_FOUND } from '../src/outposts/start-outpost.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import { accept, newChat, outpostEvents } from './outpost-store-support.ts';
import { connectCliProvider, createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let app: express.Express;
let root: string;
let projectId: string;
let lead: string;
let draftId: string;
let outpostId: string;
let api: string;
let web: string;
let apiPost: string;
let webPost: string;
let onRemote: boolean;

const git: StackGit = {
  isAncestor: async () => true,
  branchOnRemote: async () => onRemote,
};

function chat(conversationId: string, handle: string, postId: string, dependsOn?: string) {
  return {
    new: { conversationId, projectId, provider: 'codex', model: 'gpt-5', agentMode: 'read-only' },
    handle,
    firstMessage: { id: postId, text: `Build ${handle}.`, attachmentIds: [] },
    ...(dependsOn ? { dependsOn } : {}),
  };
}

beforeEach(async () => {
  t = await createTestDb();
  onRemote = true;
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-story-routes-')));
  projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  await connectCliProvider(t, 'codex');
  await saveCapabilities(t.db, t.workspaceId, {
    provider: 'codex',
    models: [{ id: 'gpt-5', label: 'GPT-5 (preview)', description: null }],
    efforts: [],
    defaultModel: 'gpt-5',
    modes: FAKE_CODEX_MODES,
  });
  app = express();
  app.use(express.json());
  app.use(
    '/api',
    outpostRoutes({
      db: t.db,
      workspaceId: t.workspaceId,
      peer: fakePeerAgent(),
      drain: async () => undefined,
      stackGit: git,
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = outpostErrorStatus(error) ?? statusForError(error);
    res.status(status).json({ error: message });
  });
  lead = await newChat(t);
  draftId = randomUUID();
  await saveDraft(t.db, {
    id: draftId,
    workspaceId: t.workspaceId,
    conversationId: lead,
    runId: null,
    outpostId: null,
    body: {
      name: 'Orders launch',
      title: 'Checkout',
      chats: [
        { handle: 'api', title: 'Orders endpoint', projectId, task: 'Build api.' },
        { handle: 'web', title: 'Orders page', projectId, task: 'Build web.', dependsOn: 'api' },
      ],
    },
  });
  [outpostId, api, web, apiPost, webPost] = [1, 2, 3, 4, 5].map(() => randomUUID()) as [
    string,
    string,
    string,
    string,
    string,
  ];
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function start() {
  return request(app)
    .post('/api/outposts')
    .send({
      id: outpostId,
      name: 'Orders launch',
      draftId,
      members: [
        { conversationId: lead, handle: 'lead' },
        chat(api, 'api', apiPost),
        chat(web, 'web', webPost, api),
      ],
    });
}

async function detail() {
  const response = await request(app).get(`/api/outposts/${outpostId}`);
  expect(response.status).toBe(200);
  return outpostDetailSchema.parse(response.body);
}

const startNow = (postId: string, outpost = outpostId) =>
  request(app).post(`/api/outposts/${outpost}/posts/${postId}/start-now`).send({});

describe('GET /api/outposts/drafts/:id', () => {
  it('returns the draft a chat proposed, and says when it was started', async () => {
    const before = await request(app).get(`/api/outposts/drafts/${draftId}`);

    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      id: draftId,
      conversationId: lead,
      outpostId: null,
      title: 'Checkout',
      startedAt: null,
      body: { name: 'Orders launch', chats: [{ handle: 'api' }, { handle: 'web' }] },
    });
    expect(Object.keys(before.body).toSorted()).toEqual([
      'body',
      'conversationId',
      'createdAt',
      'id',
      'outpostId',
      'startedAt',
      'title',
    ]);

    await start();
    const after = await request(app).get(`/api/outposts/drafts/${draftId}`);
    expect(after.body).toMatchObject({ outpostId });
    expect(after.body.startedAt).toEqual(expect.any(String));
  });

  it('answers 404 for a draft that does not exist and 400 for an id that is not one', async () => {
    const missing = await request(app).get(`/api/outposts/drafts/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: DRAFT_NOT_FOUND });
    expect((await request(app).get('/api/outposts/drafts/nope')).status).toBe(400);
  });
});

describe('GET /api/conversations/:id/outpost-drafts', () => {
  const drafts = (chatId: string) =>
    request(app).get(`/api/conversations/${chatId}/outpost-drafts`);

  it('lists what the chat proposed, with how many chats and how many stacked', async () => {
    const before = await drafts(lead);

    expect(before.status).toBe(200);
    expect(chatDraftsSchema.parse(before.body)).toEqual({
      drafts: [
        { id: draftId, runId: null, chats: 2, stacked: 1, outpostId: null, startedAt: null },
      ],
    });

    await start();
    const [started] = chatDraftsSchema.parse((await drafts(lead)).body).drafts;
    expect(started).toMatchObject({ id: draftId, outpostId });
    expect(started?.startedAt).toEqual(expect.any(String));
  });

  it('is empty for a chat that proposed nothing, and 400 for an id that is not one', async () => {
    expect((await drafts(randomUUID())).body).toEqual({ drafts: [] });
    expect((await drafts('nope')).status).toBe(400);
  });
});

describe('a story in the outpost detail', () => {
  it('starts from a draft and lists the story with its order, states and what each waits for', async () => {
    const response = await start();

    expect(response.status).toBe(201);
    const created = createOutpostResponseSchema.parse(response.body);
    expect(created.failed).toEqual([]);
    expect(created.stories).toEqual([
      {
        draftId,
        title: 'Checkout',
        leadConversationId: lead,
        leadHandle: 'lead',
        tasks: [
          expect.objectContaining({
            conversationId: api,
            handle: 'api',
            title: 'Orders endpoint',
            dependsOn: null,
            stacked: false,
            openingPostId: apiPost,
            state: 'sent',
            reason: 'Not sent yet',
          }),
          expect.objectContaining({
            conversationId: web,
            handle: 'web',
            title: 'Orders page',
            dependsOn: api,
            dependsOnHandle: 'api',
            stacked: true,
            openingPostId: webPost,
            state: 'sent',
            reason: 'Waiting for @api',
            warnings: [],
          }),
        ],
      },
    ]);
    const held = created.posts.find((post) => post.id === webPost);
    expect(held).toMatchObject({ fromUser: false, fromHandle: 'lead', reason: 'Waiting for @api' });
    expect((await detail()).stories).toEqual(created.stories);
  });

  it('shows a stack warning from the repository once both chats have a branch', async () => {
    await start();
    for (const [chatId, branch, base] of [
      [api, 'spark/api', 'main'],
      [web, 'spark/web', 'spark/api'],
    ] as const) {
      await t.db.query(
        `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
           base_branch, base_commit, owns_branch)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'abc123', true)`,
        [randomUUID(), chatId, projectId, root, join(root, branch), branch, base],
      );
    }
    onRemote = false;

    const [story] = (await detail()).stories;

    expect(story?.tasks[1]).toMatchObject({ branch: 'spark/web' });
    expect(story?.tasks[1]?.warnings.map((warning) => warning.kind)).toEqual(['parent_not_pushed']);
  });

  it('answers an outpost without a story with an empty list', async () => {
    const response = await request(app)
      .post('/api/outposts')
      .send({ id: outpostId, name: 'Plain', members: [{ conversationId: lead, handle: 'lead' }] });

    expect(outpostDetailSchema.parse(response.body).stories).toEqual([]);
  });

  it('answers 409 when the draft was already started in another outpost', async () => {
    await start();
    const second = await request(app)
      .post('/api/outposts')
      .send({
        id: randomUUID(),
        name: 'Again',
        draftId,
        members: [{ conversationId: lead, handle: 'lead' }],
      });

    expect(second.status).toBe(409);
  });
});

describe('POST /api/outposts/:id/posts/:postId/start-now', () => {
  beforeEach(async () => {
    expect((await start()).status).toBe(201);
  });

  it('releases a held request so it is sent without waiting, and tells the outpost', async () => {
    const events = await outpostEvents();
    try {
      const response = await startNow(webPost);

      expect(response.status).toBe(200);
      const released = outpostDetailSchema.parse(response.body);
      expect(released.posts.find((post) => post.id === webPost)?.reason).toBe('Not sent yet');
      expect(released.stories[0]?.tasks[1]).toMatchObject({
        dependsOn: api,
        dependsOnHandle: 'api',
        reason: 'Not sent yet',
      });
      expect(await heldRequests(t.db)).toEqual([]);
      expect((await unsentRequests(t.db)).map((post) => post.id)).toEqual([apiPost, webPost]);
      await eventually(async () => expect(events.seen).toContain(outpostId));
    } finally {
      await events.close();
    }
  });

  it('is harmless when pressed twice, on a request that is not held and on one already sent', async () => {
    expect((await startNow(webPost)).status).toBe(200);
    expect((await startNow(webPost)).status).toBe(200);
    expect((await startNow(apiPost)).status).toBe(200);
    await accept(t, webPost);

    const late = await startNow(webPost);

    expect(late.status).toBe(200);
    expect(
      outpostDetailSchema.parse(late.body).posts.find((post) => post.id === webPost),
    ).toMatchObject({ state: 'sent', reason: null });
  });

  it('refuses a post that is not a request, a post of another outpost and an unknown post', async () => {
    const notice = (await detail()).posts.find((post) => post.kind === 'notice')!;
    const refused = await startNow(notice.id);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: ONLY_REQUESTS_START });

    const unknown = await startNow(randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: POST_NOT_FOUND });
    expect((await startNow(webPost, randomUUID())).status).toBe(404);
    expect((await heldRequests(t.db)).map(({ post }) => post.id)).toEqual([webPost]);
  });
});

describe('GET /api/outposts', () => {
  it('gives each story chat its lead, the chat it starts after and its story order', async () => {
    expect((await start()).status).toBe(201);

    const response = await request(app).get('/api/outposts');

    expect(response.status).toBe(200);
    const members = outpostSchema.array().parse(response.body)[0]?.members ?? [];
    const byId = new Map(members.map((member) => [member.conversationId, member]));
    expect(byId.get(lead)?.story).toBeUndefined();
    expect(byId.get(api)?.story).toEqual({ lead, after: null, position: 0 });
    expect(byId.get(web)?.story).toEqual({ lead, after: api, position: 1 });
  });
});
