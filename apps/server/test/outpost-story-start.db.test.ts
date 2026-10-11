import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOutpostRequest, StartMember } from '@spark-outpost/contracts';
import { saveAttachment } from '../src/persistence/attachments.ts';
import {
  resolveChatSettings,
  saveCapabilities,
  updateChatSettings,
} from '../src/persistence/chat-settings.ts';
import { getDraft, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { heldRequests, listPosts, unsentRequests } from '../src/persistence/outpost-posts.ts';
import { storiesOf } from '../src/persistence/outpost-stories.ts';
import { getOutpost, OutpostError } from '../src/persistence/outposts.ts';
import { modeAboveLead } from '../src/outposts/mode-cap.ts';
import {
  DRAFT_NOT_FOUND,
  firstMessageNotSent,
  parentNotSent,
  startOutpost,
  STARTS_AFTER_NEEDS_DRAFT,
  type StartDeps,
} from '../src/outposts/start-outpost.ts';
import {
  DRAFT_ALREADY_STARTED,
  LEAD_CHAT_GONE,
  LEAD_NOT_IN_OUTPOST,
} from '../src/outposts/story-start.ts';
import { ATTACHMENT_NOT_FREE } from '../src/outposts/post-service.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { acceptTask } from '../src/persistence/outpost-tasks.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { newChat } from './outpost-store-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let deps: StartDeps;
let root: string;
let projectId: string;
let lead: string;
let draftId: string;

beforeEach(async () => {
  t = await createTestDb();
  deps = { db: t.db, workspaceId: t.workspaceId };
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-story-start-')));
  projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  await connectCliProvider(t, 'codex');
  await saveCapabilities(t.db, t.workspaceId, {
    provider: 'codex',
    models: [{ id: 'gpt-5', label: 'GPT-5 (preview)', description: null }],
    efforts: [],
    defaultModel: 'gpt-5',
    modes: FAKE_CODEX_MODES,
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
      title: 'Checkout',
      chats: [
        { handle: 'api', title: 'Orders endpoint', projectId, task: 'Add the endpoint.' },
        { handle: 'web', title: 'Orders page', projectId, task: 'Build it.', dependsOn: 'api' },
      ],
    },
  });
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

async function draftProposing(agentMode: string): Promise<string> {
  const id = randomUUID();
  await saveDraft(t.db, {
    id,
    workspaceId: t.workspaceId,
    conversationId: lead,
    runId: null,
    outpostId: null,
    body: {
      title: 'Checkout',
      chats: [
        {
          handle: 'api',
          title: 'Orders endpoint',
          projectId,
          task: 'Add the endpoint.',
          agentMode,
        },
        { handle: 'web', title: 'Orders page', projectId, task: 'Build it.', dependsOn: 'api' },
      ],
    },
  });
  return id;
}

type NewMember = Extract<StartMember, { new: object }>;

function subTask(handle: string, text: string, extra: Partial<NewMember['new']> = {}): NewMember {
  return {
    new: {
      conversationId: randomUUID(),
      projectId,
      provider: 'codex',
      model: 'gpt-5',
      agentMode: 'ask-every-action',
      ...extra,
    },
    handle,
    firstMessage: { id: randomUUID(), text, attachmentIds: [] },
  };
}

function story(extra: Partial<NewMember['new']> = {}) {
  const api = subTask('api', 'Add the endpoint, then open a PR.', extra);
  const web = { ...subTask('web', 'Build the page.'), dependsOn: api.new.conversationId };
  return { api, web };
}

function request(members: StartMember[], id = randomUUID()): CreateOutpostRequest {
  return {
    id,
    name: 'Orders launch',
    draftId,
    members: [{ conversationId: lead, handle: 'lead' }, ...members],
  };
}

async function refusal(work: Promise<unknown>): Promise<{ status: number; message: string }> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(OutpostError);
  const { status, message } = error as OutpostError;
  return { status, message };
}

async function requests(outpostId: string) {
  return (await listPosts(t.db, outpostId))
    .map(({ post }) => post)
    .filter((post) => post.kind === 'request');
}

async function count(table: 'conversations' | 'outposts' | 'outpost_story_tasks'): Promise<number> {
  const { rows } = await t.db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${table}`,
  );
  return rows[0]?.total ?? 0;
}

describe('starting a story from a draft', () => {
  it('creates the chats, writes each first message as the lead chat and holds the dependent one', async () => {
    const { api, web } = story({ level: 'hands-off' });
    const start = request([api, web]);

    const outcome = await startOutpost(deps, start);

    expect(outcome).toEqual({ created: true, failed: [] });
    const [first, held] = await requests(start.id);
    expect(first).toMatchObject({
      id: api.firstMessage!.id,
      body: 'Add the endpoint, then open a PR.',
      fromUser: false,
      userStarted: true,
      fromConversationId: lead,
      fromHandle: 'lead',
      fromRunId: null,
      toHandle: 'api',
      opening: true,
      afterPostId: null,
    });
    expect(held).toMatchObject({
      id: web.firstMessage!.id,
      fromUser: false,
      userStarted: true,
      afterPostId: first!.id,
    });
    expect((await unsentRequests(t.db)).map((post) => post.id)).toEqual([first!.id]);
    expect((await heldRequests(t.db)).map(({ post }) => post.id)).toEqual([held!.id]);
    const tasks = await storiesOf(t.db, start.id);
    expect(tasks.map((row) => [row.handle, row.task.title, row.task.openingPostId])).toEqual([
      ['api', 'Orders endpoint', first!.id],
      ['web', 'Orders page', held!.id],
    ]);
    expect(tasks[1]).toMatchObject({
      task: { draftId, leadConversationId: lead, dependsOnConversationId: api.new.conversationId },
      storyTitle: 'Checkout',
      leadHandle: 'lead',
    });
    expect(await getDraft(t.db, t.workspaceId, draftId)).toMatchObject({ outpostId: start.id });
    expect((await getDraft(t.db, t.workspaceId, draftId))?.startedAt).not.toBeNull();
    expect(await resolveChatSettings(t.db, api.new.conversationId)).toMatchObject({
      level: 'hands-off',
    });
    expect(await resolveChatSettings(t.db, web.new.conversationId)).toMatchObject({
      level: 'full-auto',
    });
  });

  it('delivers a first message as a request the user started but did not write', async () => {
    const { api } = story();
    const start = request([api]);
    await startOutpost(deps, start);
    await acceptTask(t.db, api.new.conversationId, {
      messageId: api.firstMessage!.id,
      contextId: start.id,
      text: 'Add the endpoint, then open a PR.',
    });
    await drainQueue(t.db, api.new.conversationId, async () => ({ provider: 'fake' }));
    const { rows } = await t.db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1',
      [api.new.conversationId],
    );

    const input = await loadRunInput(t.db, rows[0]!.id);

    expect(input?.outpostRequest).toMatchObject({ fromUser: false, userStarted: true });
  });

  it('changes nothing when the same start is sent again', async () => {
    const { api, web } = story();
    const start = request([api, web]);
    await startOutpost(deps, start);
    const before = [await requests(start.id), await storiesOf(t.db, start.id)];
    const chats = await count('conversations');

    const outcome = await startOutpost(deps, start);

    expect(outcome).toEqual({ created: false, failed: [] });
    expect([await requests(start.id), await storiesOf(t.db, start.id)]).toEqual(before);
    expect(await count('conversations')).toBe(chats);
  });

  it('refuses a second outpost for a draft that was already started, and creates nothing', async () => {
    const first = story();
    await startOutpost(deps, request([first.api, first.web]));
    const chats = await count('conversations');
    const second = story();

    const refused = await refusal(startOutpost(deps, request([second.api, second.web])));

    expect(refused).toEqual({ status: 409, message: DRAFT_ALREADY_STARTED });
    expect(await count('outposts')).toBe(1);
    expect(await count('conversations')).toBe(chats);
    expect(await count('outpost_story_tasks')).toBe(2);
  });

  it('lets one of two different starts of the same draft win when they race', async () => {
    const [one, two] = [story(), story()];
    const starts = [request([one.api, one.web]), request([two.api, two.web])];

    const outcomes = await Promise.allSettled(starts.map((start) => startOutpost(deps, start)));

    expect(outcomes.map((outcome) => outcome.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    const lost = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(lost?.reason).toMatchObject({ status: 409, message: DRAFT_ALREADY_STARTED });
    expect(await count('outposts')).toBe(1);
    expect(await count('outpost_story_tasks')).toBe(2);
    const winner = starts[outcomes.findIndex((outcome) => outcome.status === 'fulfilled')]!;
    expect((await getOutpost(t.db, t.workspaceId, winner.id))?.members).toHaveLength(3);
  });

  it('never starts a chat in a mode the draft proposed that asks less often than the lead chat', async () => {
    await updateChatSettings(t.db, lead, { provider: 'codex', agentMode: 'ask-every-action' });
    const proposed = await draftProposing('agent-full-access');
    const { api, web } = story({ agentMode: 'agent-full-access' });
    const start = { ...request([api, web]), draftId: proposed };

    const outcome = await startOutpost(deps, start);

    expect(outcome.failed).toEqual([
      {
        conversationId: api.new.conversationId,
        handle: 'api',
        message: modeAboveLead('api', 'lead'),
      },
      {
        conversationId: web.new.conversationId,
        handle: 'web',
        message: firstMessageNotSent('web', parentNotSent('api')),
      },
    ]);
    const chat = await t.db.query('SELECT 1 FROM conversations WHERE id = $1', [
      api.new.conversationId,
    ]);
    expect(chat.rowCount).toBe(0);
    expect(await requests(start.id)).toEqual([]);
    const tasks = await storiesOf(t.db, start.id);
    expect(tasks.map((row) => [row.handle, row.task.dependsOnConversationId, row.opening])).toEqual(
      [['web', null, null]],
    );
  });

  it('starts a chat in the mode the user raised by hand above the lead chat', async () => {
    await updateChatSettings(t.db, lead, { provider: 'codex', agentMode: 'ask-every-action' });
    const { api, web } = story({ agentMode: 'agent-full-access' });
    const start = request([api, web]);

    const outcome = await startOutpost(deps, start);

    expect(outcome.failed).toEqual([]);
    const settings = await resolveChatSettings(t.db, api.new.conversationId);
    expect(settings.agentMode).toBe('agent-full-access');
    expect((await requests(start.id)).map((post) => post.toHandle)).toEqual(['api', 'web']);
  });

  it("takes a mode the user changed away from the proposal as the user's choice", async () => {
    await updateChatSettings(t.db, lead, { provider: 'codex', agentMode: 'read-only' });
    const proposed = await draftProposing('read-only');
    const { api, web } = story({ agentMode: 'ask-every-action' });

    const outcome = await startOutpost(deps, { ...request([api, web]), draftId: proposed });

    expect(outcome.failed).toEqual([]);
  });

  it('holds a chat left on the agent default to the lead mode too', async () => {
    await updateChatSettings(t.db, lead, { provider: 'codex', agentMode: 'read-only' });
    const api = subTask('api', 'Add the endpoint.', { agentMode: null });
    const reader = subTask('docs', 'Read the docs.', { agentMode: 'read-only' });

    const outcome = await startOutpost(deps, request([api, reader]));

    expect(outcome.failed.map((failed) => failed.handle)).toEqual(['api']);
  });

  it('starts the draft in a new outpost after a start in which every chat was refused', async () => {
    const first = story();
    let present = false;
    const flaky = { ...deps, folderExists: () => Promise.resolve(present) };
    await refusal(startOutpost(flaky, request([first.api, first.web])));
    present = true;
    const { api, web } = story();
    const start = request([api, web]);

    const second = await startOutpost(flaky, start);

    expect(second).toEqual({ created: true, failed: [] });
    expect((await requests(start.id)).map((post) => post.toHandle)).toEqual(['api', 'web']);
    expect((await heldRequests(t.db)).map(({ post }) => post.toHandle)).toEqual(['web']);
    expect(await count('outpost_story_tasks')).toBe(2);
    expect((await getDraft(t.db, t.workspaceId, draftId))?.outpostId).toBe(start.id);
  });

  it('does not send a dependent first message when the one before it could not be stored', async () => {
    const used = await saveAttachment(t.db, t.workspaceId, {
      name: 'spec.md',
      mediaType: 'text/markdown',
      data: Buffer.from('# spec'),
    });
    await t.db.query('UPDATE attachments SET message_id = $2 WHERE id = $1', [
      used.id,
      await anyMessage(),
    ]);
    const { api, web } = story();
    api.firstMessage!.attachmentIds = [used.id];
    const start = request([api, web]);

    const outcome = await startOutpost(deps, start);

    expect(outcome.failed.map((failed) => failed.message)).toEqual([
      firstMessageNotSent('api', ATTACHMENT_NOT_FREE),
      firstMessageNotSent('web', parentNotSent('api')),
    ]);
    expect(await requests(start.id)).toEqual([]);
    const tasks = await storiesOf(t.db, start.id);
    expect(tasks.map((row) => [row.handle, row.task.openingPostId])).toEqual([
      ['api', null],
      ['web', null],
    ]);
  });

  it('refuses a missing draft, a lead outside the outpost and a deleted lead before creating anything', async () => {
    const { api } = story();
    const outposts = await count('outposts');

    expect(await refusal(startOutpost(deps, { ...request([api]), draftId: randomUUID() }))).toEqual(
      { status: 404, message: DRAFT_NOT_FOUND },
    );
    expect(await refusal(startOutpost(deps, { ...request([]), members: [api] }))).toEqual({
      status: 400,
      message: LEAD_NOT_IN_OUTPOST,
    });
    await t.db.query('DELETE FROM conversations WHERE id = $1', [lead]);
    expect(await refusal(startOutpost(deps, { ...request([]), members: [api] }))).toEqual({
      status: 400,
      message: LEAD_CHAT_GONE,
    });
    expect(await count('outposts')).toBe(outposts);
  });

  it('refuses chats that wait for each other, and a starts-after without a draft', async () => {
    const { api, web } = story();
    const looping = { ...api, dependsOn: web.new.conversationId };

    expect(await refusal(startOutpost(deps, request([looping, web])))).toEqual({
      status: 400,
      message: 'These chats wait for each other: @api → @web → @api.',
    });
    const { id, name, members } = request([api, web]);
    expect(await refusal(startOutpost(deps, { id, name, members }))).toEqual({
      status: 400,
      message: STARTS_AFTER_NEEDS_DRAFT,
    });
    expect(await count('outposts')).toBe(0);
  });

  it('adds a story to the outpost the lead is already in', async () => {
    const outpostId = randomUUID();
    await startOutpost(deps, {
      id: outpostId,
      name: 'Orders launch',
      members: [{ conversationId: lead, handle: 'lead' }],
    });
    const { api, web } = story();

    const outcome = await startOutpost(deps, {
      id: outpostId,
      name: 'Orders launch',
      draftId,
      members: [api, web],
    });

    expect(outcome).toEqual({ created: false, failed: [] });
    expect((await requests(outpostId)).map((post) => post.fromHandle)).toEqual(['lead', 'lead']);
    expect(await count('outpost_story_tasks')).toBe(2);
  });
});

async function anyMessage(): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', 'spec')`,
    [id, lead],
  );
  return id;
}
