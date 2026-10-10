import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOutpostRequest, StartMember } from '@spark-outpost/contracts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import { getDraft, saveDraft } from '../src/persistence/outpost-drafts.ts';
import { OutpostError } from '../src/persistence/outposts.ts';
import { folderMissing, startOutpost, type StartDeps } from '../src/outposts/start-outpost.ts';
import { nothingStarted } from '../src/outposts/story-claim.ts';
import { FAKE_CODEX_MODES } from '../src/providers/fake.ts';
import { createProject } from '../src/projects/projects.ts';
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
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-story-refused-')));
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

type NewMember = Extract<StartMember, { new: object }>;

function subTask(handle: string, text: string): NewMember {
  return {
    new: {
      conversationId: randomUUID(),
      projectId,
      provider: 'codex',
      model: 'gpt-5',
      agentMode: 'ask-every-action',
    },
    handle,
    firstMessage: { id: randomUUID(), text, attachmentIds: [] },
  };
}

function story() {
  const api = subTask('api', 'Add the endpoint, then open a PR.');
  const web = { ...subTask('web', 'Build the page.'), dependsOn: api.new.conversationId };
  return { api, web };
}

function request(members: StartMember[]): CreateOutpostRequest {
  return {
    id: randomUUID(),
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

async function count(table: 'conversations' | 'outposts' | 'outpost_story_tasks'): Promise<number> {
  const { rows } = await t.db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${table}`,
  );
  return rows[0]?.total ?? 0;
}

describe('a story start in which chats are refused', () => {
  it('creates and claims nothing when every new chat is refused, and says why for each', async () => {
    const { api, web } = story();
    const missing = { ...deps, folderExists: () => Promise.resolve(false) };
    const chats = await count('conversations');

    const refused = await refusal(startOutpost(missing, request([api, web])));

    const why = folderMissing(basename(root));
    expect(refused).toEqual({
      status: 409,
      message: nothingStarted([
        { conversationId: api.new.conversationId, handle: 'api', message: why },
        { conversationId: web.new.conversationId, handle: 'web', message: why },
      ]),
    });
    expect(refused.message).toContain(`@api: ${why}`);
    expect(await count('outposts')).toBe(0);
    expect(await count('conversations')).toBe(chats);
    expect(await count('outpost_story_tasks')).toBe(0);
    expect(await getDraft(t.db, t.workspaceId, draftId)).toMatchObject({
      startedAt: null,
      outpostId: null,
    });
    const membership = await t.db.query(
      'SELECT 1 FROM outpost_members WHERE conversation_id = $1',
      [lead],
    );
    expect(membership.rowCount).toBe(0);
  });

  it('keeps an outpost that was there before and a story that already started', async () => {
    const { api, web } = story();
    const start = request([api, web]);
    await startOutpost(deps, start);
    const late = subTask('docs', 'Write the notes.');
    const missing = { ...deps, folderExists: () => Promise.resolve(false) };

    const again = await startOutpost(missing, { ...start, members: [...start.members, late] });

    expect(again.created).toBe(false);
    expect(again.failed.map((failed) => failed.handle)).toEqual(['docs']);
    expect(await count('outposts')).toBe(1);
    expect(await count('outpost_story_tasks')).toBe(2);
    expect((await getDraft(t.db, t.workspaceId, draftId))?.startedAt).not.toBeNull();
  });
});
