import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDraftResponseSchema, type DraftChat } from '@spark-outpost/contracts';
import { outpostErrorStatus, outpostRoutes } from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import {
  resolveChatSettings,
  saveCapabilities,
  updateChatSettings,
} from '../src/persistence/chat-settings.ts';
import { getDraft, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { DRAFT_NOT_FOUND } from '../src/outposts/start-outpost.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: express.Express;
let root: string;
let projectId: string;
let lead: { conversationId: string; runId: string };

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-draft-start-')));
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
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = outpostErrorStatus(error) ?? statusForError(error);
    res.status(status).json({ error: message });
  });
  lead = await startChat(t, 'split the docs work');
  await updateChatSettings(t.db, lead.conversationId, {
    provider: 'codex',
    agentMode: 'ask-every-action',
  });
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

async function draftOf(chats: DraftChat[]): Promise<string> {
  const id = randomUUID();
  await saveDraft(t.db, {
    id,
    workspaceId: t.workspaceId,
    conversationId: lead.conversationId,
    runId: lead.runId,
    outpostId: null,
    body: { name: 'Docs split', title: 'Read the docs', chats },
  });
  return id;
}

const proposed = (handle: string, extra: Partial<DraftChat> = {}): DraftChat => ({
  handle,
  title: `Read ${handle}`,
  projectId,
  task: `Read the ${handle} docs and summarise them.`,
  ...extra,
});

const start = (id: string) => request(app).post(`/api/outposts/drafts/${id}/start`).send({});

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await t.db.query<{ n: number }>(sql, values);
  return rows[0]!.n;
}

async function auditRows(): Promise<number> {
  return count(
    `SELECT count(*)::int AS n FROM run_protocol_log WHERE run_id = $1 AND method = 'spark/start_outpost'`,
    [lead.runId],
  );
}

describe('POST /api/outposts/drafts/:id/start', () => {
  it('starts the draft as proposed: the lead joins, each chat is created in the lead’s mode and gets its first message', async () => {
    const id = await draftOf([proposed('api'), proposed('guide')]);
    const response = await start(id);
    expect(response.status).toBe(201);
    const body = startDraftResponseSchema.parse(response.body);
    expect(body.message).toBe('Started outpost Docs split with 2 chats.');
    expect(body.failed).toEqual([]);
    const { rows: members } = await t.db.query<{ handle: string; conversation_id: string }>(
      'SELECT handle, conversation_id FROM outpost_members WHERE outpost_id = $1 ORDER BY handle',
      [body.outpostId],
    );
    expect(members.map((member) => member.handle)).toEqual(['api', 'guide', expect.any(String)]);
    expect(members.some((member) => member.conversation_id === lead.conversationId)).toBe(true);
    for (const member of members.filter((each) => each.conversation_id !== lead.conversationId)) {
      const settings = await resolveChatSettings(t.db, member.conversation_id);
      expect(settings).toMatchObject({ provider: 'codex', agentMode: 'ask-every-action' });
    }
    const { rows: posts } = await t.db.query<{ user_started: boolean; agent_started: boolean }>(
      `SELECT user_started, agent_started FROM outpost_posts
       WHERE outpost_id = $1 AND kind = 'request'`,
      [body.outpostId],
    );
    expect(posts).toEqual([
      { user_started: true, agent_started: false },
      { user_started: true, agent_started: false },
    ]);
    expect(await count('SELECT count(*)::int AS n FROM outpost_story_tasks')).toBe(2);
    expect((await getDraft(t.db, t.workspaceId, id))!.startedAt).not.toBeNull();
    expect(await auditRows()).toBe(1);
  });

  it('answers a second start with the outpost it already started, creating nothing more', async () => {
    const id = await draftOf([proposed('api')]);
    const first = startDraftResponseSchema.parse((await start(id)).body);
    const chats = await count('SELECT count(*)::int AS n FROM conversations');
    const again = await start(id);
    expect(again.status).toBe(200);
    expect(startDraftResponseSchema.parse(again.body).outpostId).toBe(first.outpostId);
    expect(await count('SELECT count(*)::int AS n FROM conversations')).toBe(chats);
    expect(await auditRows()).toBe(1);
  });

  it('lowers a mode above the lead’s to the highest one the lead allows', async () => {
    const id = await draftOf([proposed('api', { agentMode: 'agent-full-access' })]);
    const body = startDraftResponseSchema.parse((await start(id)).body);
    const { rows } = await t.db.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM outpost_members WHERE outpost_id = $1 AND handle = 'api'`,
      [body.outpostId],
    );
    const settings = await resolveChatSettings(t.db, rows[0]!.conversation_id);
    expect(settings.agentMode).toBe('ask-every-action');
  });

  it('refuses the whole start when a chat’s mode cannot be held to the lead’s, and creates nothing', async () => {
    await updateChatSettings(t.db, lead.conversationId, { agentMode: 'read-only' });
    const id = await draftOf([proposed('api'), proposed('web', { agent: 'claude' })]);
    const chats = await count('SELECT count(*)::int AS n FROM conversations');
    const response = await start(id);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/^@web cannot start in a mode that asks less often than @/);
    expect(await count('SELECT count(*)::int AS n FROM conversations')).toBe(chats);
    expect(await count('SELECT count(*)::int AS n FROM outposts')).toBe(0);
    expect((await getDraft(t.db, t.workspaceId, id))!.startedAt).toBeNull();
  });

  it('says when the draft does not exist', async () => {
    const response = await start(randomUUID());
    expect(response.status).toBe(404);
    expect(response.body.error).toBe(DRAFT_NOT_FOUND);
  });
});
