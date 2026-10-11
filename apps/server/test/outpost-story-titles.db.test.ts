import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StartMember } from '@spark-outpost/contracts';
import { startOutpost, type StartDeps } from '../src/outposts/start-outpost.ts';
import { applyAutoTitle, recordSuggestedTitle } from '../src/persistence/auto-title.ts';
import { updateConversation } from '../src/persistence/conversation-actions.ts';
import { saveDraft } from '../src/persistence/outpost-drafts.ts';
import { createProject } from '../src/projects/projects.ts';
import { drainQueue } from '../src/workflow/queue-drain.ts';
import { postRunId } from './outpost-fixtures.ts';
import { accept, newChat } from './outpost-store-support.ts';
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
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-story-titles-')));
  projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  await connectCliProvider(t, 'codex');
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
      chats: [{ handle: 'api', title: 'Orders endpoint', projectId, task: 'Add the endpoint.' }],
    },
  });
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

function subTask(handle: string, text: string): Extract<StartMember, { new: object }> {
  return {
    new: {
      conversationId: randomUUID(),
      projectId,
      provider: 'codex',
      model: null,
      agentMode: null,
    },
    handle,
    firstMessage: { id: randomUUID(), text, attachmentIds: [] },
  };
}

async function titleOf(conversationId: string) {
  const { rows } = await t.db.query<{ title: string; titleSource: string }>(
    'SELECT title, title_source AS "titleSource" FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]!;
}

async function start(members: StartMember[], withDraft = true): Promise<void> {
  const outcome = await startOutpost(deps, {
    id: randomUUID(),
    name: 'Orders launch',
    ...(withDraft ? { draftId } : {}),
    members: [{ conversationId: lead, handle: 'lead' }, ...members],
  });
  expect(outcome.failed).toEqual([]);
}

describe('the title of a sub-chat started from a draft', () => {
  it('is the draft’s title for that chat, and its first turn does not retitle it', async () => {
    const api = subTask('api', 'Add the orders endpoint and its tests.');
    await start([api]);

    expect(await titleOf(api.new.conversationId)).toEqual({
      title: 'Orders endpoint',
      titleSource: 'user',
    });

    await accept(t, api.firstMessage!.id);
    await drainQueue(t.db, api.new.conversationId, async () => ({ provider: 'codex' }));
    const runId = (await postRunId(t.db, api.firstMessage!.id))!;
    await recordSuggestedTitle(t.db, runId, 'Feature · orders endpoint tests');

    expect(await applyAutoTitle(t.db, runId)).toBeNull();
    expect((await titleOf(api.new.conversationId)).title).toBe('Orders endpoint');
  });

  it('can still be renamed by the user', async () => {
    const api = subTask('api', 'Add the orders endpoint.');
    await start([api]);

    await updateConversation(t.db, t.workspaceId, api.new.conversationId, { title: 'Orders API' });

    expect((await titleOf(api.new.conversationId)).title).toBe('Orders API');
  });

  it('is the first line of its first message for a chat the draft did not name', async () => {
    const docs = subTask('docs', 'Write the guide page.\nKeep it short.');
    await start([docs]);

    expect((await titleOf(docs.new.conversationId)).title).toBe('Write the guide page.');
  });

  it('is left to auto-titling for a chat created without a draft', async () => {
    const api = subTask('api', 'Add the orders endpoint.');
    await start([api], false);

    expect((await titleOf(api.new.conversationId)).titleSource).not.toBe('user');
  });
});
