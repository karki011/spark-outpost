import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONVERSATION_PROJECTS_MAX, SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { conversationProjectIds } from '../src/agent-config/store.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { createProject, listProjects } from '../src/projects/projects.ts';
import { saveReposFolders, sparkReposRules } from '../src/projects/repos-folders.ts';
import { saveRemoteSwitches } from '../src/remote/store.ts';
import {
  answerCard,
  cardResult,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let base: string;
let code: string;
let t: TestDb;
let tools: SparkToolsHarness;
let recorded: RecordedHooks;
let chat: { conversationId: string; runId: string };
let existing: string;
const realHomeEnv = process.env.HOME;

async function repo(folder: string, origin: string | null): Promise<void> {
  await mkdir(join(folder, '.git'), { recursive: true });
  const remote = origin ? `[remote "origin"]\n\turl = ${origin}\n` : '';
  await writeFile(join(folder, '.git', 'config'), remote);
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-link-repo-')));
  process.env.HOME = base;
  code = join(base, 'code');
  await repo(join(code, 'feature-identity'), 'git@github.com:acme/identity.git');
  await repo(join(code, 'identity-admin'), null);
  await repo(join(code, 'existing'), null);
  await mkdir(join(code, 'plain'), { recursive: true });
  await repo(join(base, 'elsewhere', 'outside'), null);
});

afterAll(async () => {
  process.env.HOME = realHomeEnv;
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  chat = await startChat(t, 'link the identity repo');
  existing = (await createProject(t.db, t.workspaceId, join(code, 'existing'))).project.id;
  await setConversationProjects(t.db, t.workspaceId, chat.conversationId, [existing]);
  await saveReposFolders(t.db, t.workspaceId, [code], sparkReposRules());
  await setMode('bypassPermissions');
  tools = await startSparkTools(t, {
    conversationId: chat.conversationId,
    runId: chat.runId,
    actions: recorded.hooks,
  });
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

async function setMode(mode: string): Promise<void> {
  await t.db.query(
    `UPDATE runs SET provider = 'claude', agent_mode = $2, used_mode = $2 WHERE id = $1`,
    [chat.runId, mode],
  );
}

async function openSession(): Promise<void> {
  await t.db.query(
    `INSERT INTO provider_sessions
       (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash, last_used_at)
     VALUES ($1, $2, 'claude', 'chat:do', $3, '/tmp', 'h', now())`,
    [randomUUID(), chat.conversationId, randomUUID()],
  );
}

async function closeReason(): Promise<string | null> {
  const { rows } = await t.db.query<{ close_reason: string | null }>(
    'SELECT close_reason FROM provider_sessions WHERE conversation_id = $1',
    [chat.conversationId],
  );
  return rows[0]?.close_reason ?? null;
}

describe('spark_find_repo', () => {
  it('lists every match, exact origin first, with whether it is linked', async () => {
    const found = (await tools.call('spark_find_repo', { name: 'identity' })).json<{
      matches: { name: string; path: string; origin: string | null; sparkProject: boolean }[];
      partial: boolean;
    }>();
    expect(found.matches).toEqual([
      {
        name: 'feature-identity',
        path: '~/code/feature-identity',
        origin: 'acme/identity',
        sparkProject: false,
        linked: false,
      },
      {
        name: 'identity-admin',
        path: '~/code/identity-admin',
        origin: null,
        sparkProject: false,
        linked: false,
      },
    ]);
    expect(found.partial).toBe(false);
    const linked = (await tools.call('spark_find_repo', { name: 'existing' })).json<{
      matches: { linked: boolean; sparkProject: boolean }[];
    }>();
    expect(linked.matches).toEqual([expect.objectContaining({ linked: true, sparkProject: true })]);
  });
});

describe('spark_link_repo', () => {
  it('asks even in Bypass permissions, then appends the repo and closes the sessions', async () => {
    await openSession();
    const asked = (await tools.call('spark_link_repo', { repo: '~/code/feature-identity' })).json<{
      outcome: string;
    }>();
    expect(asked.outcome).toBe('waiting_for_user');
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect(card.title).toBe('Link feature-identity to this chat?');
    const done = await cardResult(t, card.id);
    expect(done.payload.sparkResult?.message).toBe(
      'Linked feature-identity. This chat can use it from your next message.',
    );
    const projects = await listProjects(t.db, t.workspaceId);
    const added = projects.find((project) => project.name === 'feature-identity');
    expect(await conversationProjectIds(t.db, chat.conversationId)).toEqual([existing, added!.id]);
    expect(await closeReason()).toBe('repos changed');
  });

  it('changes nothing when the user declines', async () => {
    await openSession();
    await tools.call('spark_link_repo', { repo: join(code, 'feature-identity') });
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    expect((await cardResult(t, card.id)).status).toBe('denied');
    expect(await conversationProjectIds(t.db, chat.conversationId)).toEqual([existing]);
    expect((await listProjects(t.db, t.workspaceId)).map((project) => project.name)).toEqual([
      'existing',
    ]);
    expect(await closeReason()).toBeNull();
  });

  it('refuses a folder outside the repos folders and one that is not a git repo', async () => {
    const outside = await tools.call('spark_link_repo', { repo: '~/elsewhere/outside' });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain('is not in a repos folder');
    const plain = await tools.call('spark_link_repo', { repo: '~/code/plain' });
    expect(plain.text).toBe('~/code/plain is not a git repository.');
  });

  it('adds no project when the chat already has the most repos it can link', async () => {
    const full = [existing];
    for (let index = 1; index < CONVERSATION_PROJECTS_MAX; index += 1) {
      const folder = join(base, 'full', `repo-${index}`);
      await mkdir(folder, { recursive: true });
      full.push((await createProject(t.db, t.workspaceId, folder)).project.id);
    }
    await setConversationProjects(t.db, t.workspaceId, chat.conversationId, full);
    await tools.call('spark_link_repo', { repo: '~/code/feature-identity' });
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    await cardResult(t, card.id);
    const names = (await listProjects(t.db, t.workspaceId)).map((project) => project.name);
    expect(names).not.toContain('feature-identity');
    expect(await conversationProjectIds(t.db, chat.conversationId)).toEqual(full);
  });

  it('links nothing when the folder was swapped after the card was shown', async () => {
    const folder = join(code, 'swapped');
    await repo(folder, null);
    await tools.call('spark_link_repo', { repo: '~/code/swapped' });
    await rename(folder, join(base, 'swapped-away'));
    await symlink(join(code, 'existing'), folder);
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const done = await cardResult(t, card.id);
    expect(done.payload.sparkResult?.message).toContain('changed after the card was shown');
    expect(await conversationProjectIds(t.db, chat.conversationId)).toEqual([existing]);
  });

  it('refuses a turn from a paired device unless its link switch is on', async () => {
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [
      chat.runId,
      randomUUID(),
    ]);
    await saveRemoteSwitches(t.db, t.workspaceId, { projects: false });
    const refused = await tools.call('spark_link_repo', { repo: '~/code/feature-identity' });
    expect(refused.text).toContain('Link a new folder or clone a repo');
    await saveRemoteSwitches(t.db, t.workspaceId, { projects: true });
    const asked = await tools.call('spark_link_repo', { repo: '~/code/feature-identity' });
    expect(asked.json<{ outcome: string }>().outcome).toBe('waiting_for_user');
  });
});
