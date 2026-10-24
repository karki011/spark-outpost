import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDraftResponseSchema } from '@spark-outpost/contracts';
import { outpostErrorStatus, outpostRoutes } from '../src/api/outpost-routes.ts';
import { statusForError } from '../src/api/routes.ts';
import {
  resolveChatSettings,
  saveCapabilities,
  updateChatSettings,
} from '../src/persistence/chat-settings.ts';
import { getDraft } from '../src/persistence/outpost-drafts.ts';
import { createProject } from '../src/projects/projects.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { outpostDraftTool } from '../src/spark-mcp/tools/outpost-draft-tool.ts';
import { CHAT_AND_PROJECT } from '../src/spark-mcp/tools/outpost-reuse.ts';
import { fakePeerAgent } from './fake-peer-agent.ts';
import { linkProject, toolHarness } from './outpost-tool-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: express.Express;
let root: string;
let shop: string;
let lead: { conversationId: string; runId: string };
let usage: string;

interface Drafted {
  draft: string;
  chats: { handle: string; stacked: boolean; note: string; existingChat?: string }[];
}

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-reuse-chat-')));
  shop = (await createProject(t.db, t.workspaceId, root)).project.id;
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
  lead = await startChat(t, 'split the session work');
  await linkProject(t, lead.conversationId, shop);
  await updateChatSettings(t.db, lead.conversationId, {
    provider: 'codex',
    agentMode: 'ask-every-action',
  });
  usage = (await startChat(t, 'register session activity')).conversationId;
  await linkProject(t, usage, shop);
  await updateChatSettings(t.db, usage, { provider: 'codex', agentMode: 'agent-full-access' });
  await t.db.query(`UPDATE conversations SET title = 'Register usage' WHERE id = $1`, [usage]);
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

const fresh = (handle: string, extra: Record<string, unknown> = {}) => ({
  handle,
  title: `${handle} work`,
  project: shop,
  task: `Build the ${handle} part.`,
  ...extra,
});

const reused = (handle: string, extra: Record<string, unknown> = {}) => ({
  handle,
  title: 'Register it',
  chat: usage,
  task: 'Register the endpoint once @api has it.',
  ...extra,
});

function propose(chats: unknown[]): Promise<Drafted> {
  const harness = toolHarness(t, lead);
  return outpostDraftTool.run(
    { title: 'Sessions', name: 'Sessions activity', chats },
    harness.context,
  ) as Promise<Drafted>;
}

describe('a proposal that names an existing chat', () => {
  it('saves the chat with its own project and never stacks it', async () => {
    const drafted = await propose([fresh('api'), reused('usage', { dependsOn: 'api' })]);
    const stored = await getDraft(t.db, t.workspaceId, drafted.draft);
    expect(stored?.body.chats[1]).toEqual({
      handle: 'usage',
      title: 'Register it',
      projectId: shop,
      chatId: usage,
      task: 'Register the endpoint once @api has it.',
      dependsOn: 'api',
    });
    expect(drafted.chats[1]).toMatchObject({
      handle: '@usage',
      existingChat: usage,
      stacked: false,
      note: 'existing chat, gets a request: order only: it keeps its own branch',
    });
  });

  it('refuses a project or mode beside the chat, the lead itself, and a chat in a story', async () => {
    await expect(propose([reused('usage', { project: shop })])).rejects.toThrow(CHAT_AND_PROJECT);
    await expect(propose([reused('me', { chat: lead.conversationId })])).rejects.toThrow(
      'this chat cannot send a request to itself',
    );
    const first = await propose([fresh('api'), reused('usage')]);
    const started = await request(app).post(`/api/outposts/drafts/${first.draft}/start`).send({});
    expect(started.status).toBe(201);
    await expect(propose([reused('usage')])).rejects.toThrow('that chat is already in a story');
  });
});

describe('starting a draft with an existing chat', () => {
  it('sends it a request from the lead and keeps its title, mode and branch', async () => {
    const drafted = await propose([fresh('api'), reused('usage', { dependsOn: 'api' })]);

    const response = await request(app)
      .post(`/api/outposts/drafts/${drafted.draft}/start`)
      .send({});

    expect(response.status).toBe(201);
    const body = startDraftResponseSchema.parse(response.body);
    expect(body.failed).toEqual([]);
    const { rows: chats } = await t.db.query<{ title: string }>(
      'SELECT title FROM conversations WHERE id = $1',
      [usage],
    );
    expect(chats[0]?.title).toBe('Register usage');
    expect(await resolveChatSettings(t.db, usage)).toMatchObject({
      agentMode: 'agent-full-access',
    });
    const { rows: posts } = await t.db.query<{
      from_conversation_id: string;
      from_user: boolean;
      after_post_id: string | null;
    }>(
      `SELECT from_conversation_id, from_user, after_post_id FROM outpost_posts
       WHERE to_conversation_id = $1`,
      [usage],
    );
    expect(posts).toEqual([
      {
        from_conversation_id: lead.conversationId,
        from_user: false,
        after_post_id: expect.any(String),
      },
    ]);
    const { rows: tasks } = await t.db.query<{ depends_on_conversation_id: string | null }>(
      'SELECT depends_on_conversation_id FROM outpost_story_tasks WHERE conversation_id = $1',
      [usage],
    );
    expect(tasks).toEqual([{ depends_on_conversation_id: null }]);
  });
});
