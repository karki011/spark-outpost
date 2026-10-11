import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOutpostRequest, StartMember } from '@spark-outpost/contracts';
import { saveAttachment } from '../src/persistence/attachments.ts';
import { resolveChatSettings, saveCapabilities } from '../src/persistence/chat-settings.ts';
import { listConversations, pruneEmptyConversations } from '../src/persistence/conversations.ts';
import { listPosts } from '../src/persistence/outpost-posts.ts';
import { acceptTask } from '../src/persistence/outpost-tasks.ts';
import { getOutpost } from '../src/persistence/outposts.ts';
import { introViews } from '../src/outposts/intro-view.ts';
import { joinOutpost, ATTACHMENT_NOT_FREE } from '../src/outposts/post-service.ts';
import {
  firstMessageNotSent,
  folderMissing,
  startOutpost,
  type StartDeps,
} from '../src/outposts/start-outpost.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { newChat } from './outpost-store-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let deps: StartDeps;
let root: string;
let projectId: string;
let projectName: string;
let web: string;

beforeEach(async () => {
  t = await createTestDb();
  deps = { db: t.db, workspaceId: t.workspaceId };
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-start-outpost-')));
  const { project } = await createProject(t.db, t.workspaceId, root);
  projectId = project.id;
  projectName = project.name;
  await connectCliProvider(t, 'codex');
  await saveCapabilities(t.db, t.workspaceId, {
    provider: 'codex',
    models: [{ id: 'gpt-5', label: 'GPT-5 (preview)', description: null }],
    efforts: [],
    defaultModel: 'gpt-5',
    modes: FAKE_CODEX_MODES,
  });
  web = await newChat(t);
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function newMember(overrides: Partial<Extract<StartMember, { new: object }>['new']> = {}) {
  return {
    new: {
      conversationId: randomUUID(),
      projectId,
      provider: 'codex' as const,
      model: 'gpt-5',
      agentMode: 'ask-every-action',
      ...overrides,
    },
    handle: 'api',
  };
}

function request(members: StartMember[]): CreateOutpostRequest {
  return { id: randomUUID(), name: 'Usage by user', members };
}

function firstMessage(text: string, attachmentIds: string[] = []) {
  return { id: randomUUID(), text, attachmentIds };
}

async function thread(outpostId: string) {
  return (await listPosts(t.db, outpostId)).map(({ post }) => post);
}

async function upload(name: string): Promise<string> {
  const saved = await saveAttachment(t.db, t.workspaceId, {
    name,
    mediaType: 'text/markdown',
    data: Buffer.from(`# ${name}`),
  });
  return saved.id;
}

async function chatCount(id: string): Promise<number> {
  const { rowCount } = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [id]);
  return rowCount ?? 0;
}

describe('starting an outpost', () => {
  it('creates the new chats with their project, agent and mode, and joins every chat', async () => {
    const api = newMember();
    const start = request([{ conversationId: web, handle: 'fe' }, api]);

    const outcome = await startOutpost(deps, start);

    expect(outcome).toEqual({ created: true, failed: [] });
    const outpost = await getOutpost(t.db, t.workspaceId, start.id);
    expect(outpost?.members.map((member) => [member.conversationId, member.handle])).toEqual([
      [web, 'fe'],
      [api.new.conversationId, 'api'],
    ]);
    expect(await resolveChatSettings(t.db, api.new.conversationId)).toMatchObject({
      provider: 'codex',
      model: 'gpt-5',
      agentMode: 'ask-every-action',
      routing: 'pinned',
      level: 'full-auto',
    });
    const linked = await t.db.query<{ project_id: string }>(
      'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
      [api.new.conversationId],
    );
    expect(linked.rows).toEqual([{ project_id: projectId }]);
  });

  it('leaves the model to the defaults when none was picked', async () => {
    const api = newMember({ model: null, agentMode: null });
    await startOutpost(deps, request([api]));

    expect(await resolveChatSettings(t.db, api.new.conversationId)).toMatchObject({
      provider: 'codex',
      routing: 'auto',
    });
  });

  it.each([
    ['claude-sonnet-5', 'Claude Sonnet 5'],
    ['sonnet', 'Claude sonnet'],
  ])(
    'names a model the capability list does not carry by its card, and an alias as typed (%s)',
    async (model, shown) => {
      await connectCliProvider(t, 'claude');
      const api = newMember({ provider: 'claude', model, agentMode: null });
      const start = request([api]);
      await startOutpost(deps, start);

      const posts = await listPosts(t.db, start.id);
      const notices = posts.filter(({ post }) => post.kind === 'notice');
      expect(notices.map(({ post }) => post.body.split(' · ').slice(0, 3))).toEqual([
        ['@api joined', projectName, shown],
      ]);
    },
  );

  it('introduces each member from its facts and names its task', async () => {
    const api = { ...newMember(), firstMessage: firstMessage('Add an optional userId filter.') };
    const start = request([{ conversationId: web, handle: 'fe' }, api]);
    await startOutpost(deps, start);

    const outpost = (await getOutpost(t.db, t.workspaceId, start.id))!;
    const posts = await listPosts(t.db, start.id);
    const intros = await introViews(t.db, outpost, posts);
    const lines = posts
      .filter(({ post }) => post.kind === 'notice')
      .map(({ post }) => intros.get(post.id));

    expect(lines).toEqual([
      {
        body: '@fe joined · Codex Auto · Approve for me',
        intro: { conversationId: web, task: null },
      },
      {
        body: `@api joined · ${projectName} · Codex GPT-5 · Ask every time`,
        intro: {
          conversationId: api.new.conversationId,
          task: 'Task: Add an optional userId filter.',
        },
      },
    ]);
  });

  it('follows a renamed handle in the introduction line', async () => {
    const start = request([{ conversationId: web, handle: 'fe' }]);
    await startOutpost(deps, start);
    await joinOutpost(deps, { outpostId: start.id, conversationId: web, handle: 'frontend' });

    const outpost = (await getOutpost(t.db, t.workspaceId, start.id))!;
    const posts = await listPosts(t.db, start.id);
    const [line] = [...(await introViews(t.db, outpost, posts)).values()];

    expect(line?.body.startsWith('@frontend joined')).toBe(true);
    expect(posts[0]?.post.body.startsWith('@fe joined')).toBe(true);
  });

  it('posts every first message as a request from the user, in list order', async () => {
    const api = { ...newMember(), firstMessage: firstMessage('Add the filter.') };
    const fe = { conversationId: web, handle: 'fe', firstMessage: firstMessage('Use the filter.') };
    const start = request([api, fe]);
    await startOutpost(deps, start);

    const requests = (await thread(start.id)).filter((post) => post.kind === 'request');

    expect(requests).toMatchObject([
      {
        id: api.firstMessage.id,
        body: 'Add the filter.',
        fromUser: true,
        fromConversationId: null,
        toHandle: 'api',
        toConversationId: api.new.conversationId,
        opening: true,
        taskId: null,
      },
      {
        id: fe.firstMessage.id,
        body: 'Use the filter.',
        fromUser: true,
        toHandle: 'fe',
        toConversationId: web,
        opening: true,
      },
    ]);
  });

  it('does the work once when the same request is sent again', async () => {
    const api = { ...newMember(), firstMessage: firstMessage('Add the filter.') };
    const start = request([{ conversationId: web, handle: 'fe' }, api]);
    await startOutpost(deps, start);
    const before = await thread(start.id);

    const again = await startOutpost(deps, start);

    expect(again).toEqual({ created: false, failed: [] });
    expect(await thread(start.id)).toEqual(before);
    expect(await chatCount(api.new.conversationId)).toBe(1);
  });

  it('starts with the rest when one chat cannot be created, and a repeat adds it', async () => {
    const docs = { ...newMember({ provider: 'claude', agentMode: null }), handle: 'docs' };
    const withMessage = { ...docs, firstMessage: firstMessage('Document the filter.') };
    const start = request([{ conversationId: web, handle: 'fe' }, withMessage]);

    const first = await startOutpost(deps, start);

    expect(first).toEqual({
      created: true,
      failed: [
        {
          conversationId: docs.new.conversationId,
          handle: 'docs',
          message: 'Connect this provider before using it in a chat.',
        },
      ],
    });
    expect(await chatCount(docs.new.conversationId)).toBe(0);
    expect((await thread(start.id)).map((post) => post.kind)).toEqual(['notice']);

    await connectCliProvider(t, 'claude');
    const second = await startOutpost(deps, start);

    expect(second).toEqual({ created: false, failed: [] });
    expect((await thread(start.id)).map((post) => post.kind)).toEqual([
      'notice',
      'notice',
      'request',
    ]);
  });

  it('says so when the project folder is gone, and creates no chat for it', async () => {
    const api = newMember();
    const outcome = await startOutpost(
      { ...deps, folderExists: async () => false },
      request([api]),
    );

    expect(outcome.failed).toEqual([
      {
        conversationId: api.new.conversationId,
        handle: 'api',
        message: folderMissing(projectName),
      },
    ]);
    expect(await chatCount(api.new.conversationId)).toBe(0);
  });

  it('reports a chat that is already in another outpost and still adds the others', async () => {
    await startOutpost(deps, request([{ conversationId: web, handle: 'fe' }]));
    const docs = await newChat(t);
    const second = request([
      { conversationId: web, handle: 'web' },
      { conversationId: docs, handle: 'docs' },
    ]);

    const outcome = await startOutpost(deps, second);

    expect(outcome.failed.map((failure) => failure.handle)).toEqual(['web']);
    const outpost = await getOutpost(t.db, t.workspaceId, second.id);
    expect(outpost?.members.map((member) => member.handle)).toEqual(['docs']);
  });
});

describe('a member chat with no messages', () => {
  it('is listed with the chats and is not cleared away as an empty draft', async () => {
    const api = newMember();
    await startOutpost(deps, request([api]));
    const loose = await newChat(t);
    await t.db.query(`UPDATE conversations SET updated_at = now() - interval '2 days'`);

    await pruneEmptyConversations(t.db, t.workspaceId);
    const listed = (await listConversations(t.db, t.workspaceId)).map((chat) => chat.id);

    expect(listed).toEqual([api.new.conversationId]);
    expect(await chatCount(api.new.conversationId)).toBe(1);
    expect(await chatCount(loose)).toBe(0);
    expect(await chatCount(web)).toBe(0);
  });
});

describe('files on a first message', () => {
  it('stay with the request and reach the first turn of the member chat', async () => {
    const fileId = await upload('usage-contract.md');
    const api = { ...newMember(), firstMessage: firstMessage('Follow the contract.', [fileId]) };
    const start = request([api]);
    await startOutpost(deps, start);
    const chatId = api.new.conversationId;

    const [, stored] = await thread(start.id);
    expect(stored?.attachmentIds).toEqual([fileId]);

    await acceptTask(t.db, chatId, {
      messageId: api.firstMessage.id,
      contextId: start.id,
      text: 'Follow the contract.',
    });
    expect(await drainQueue(t.db, chatId, async () => ({ provider: 'fake' }))).toBe('sent');

    const run = await t.db.query<{ id: string; user_message_id: string }>(
      'SELECT id, user_message_id FROM runs WHERE conversation_id = $1',
      [chatId],
    );
    expect(run.rows[0]?.user_message_id).toBe(api.firstMessage.id);
    const input = await loadRunInput(t.db, run.rows[0]!.id);
    expect(input.attachments.map((file) => file.name)).toEqual(['usage-contract.md']);
  });

  it('refuses a file that was already sent and says the chat still joined', async () => {
    const fileId = await upload('usage-contract.md');
    await t.db.query('UPDATE attachments SET message_id = $2 WHERE id = $1', [
      fileId,
      (
        await t.db.query<{ id: string }>(
          `INSERT INTO messages (id, conversation_id, role, content)
           VALUES ($1, $2, 'user', 'earlier') RETURNING id`,
          [randomUUID(), web],
        )
      ).rows[0]!.id,
    ]);
    const api = { ...newMember(), firstMessage: firstMessage('Follow the contract.', [fileId]) };
    const start = request([api]);

    const outcome = await startOutpost(deps, start);

    expect(outcome.failed).toEqual([
      {
        conversationId: api.new.conversationId,
        handle: 'api',
        message: firstMessageNotSent('api', ATTACHMENT_NOT_FREE),
      },
    ]);
    expect((await thread(start.id)).map((post) => post.kind)).toEqual(['notice']);
  });
});
