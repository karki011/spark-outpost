import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { conversationProjectIds } from '../src/agent-config/store.ts';
import type { CloneJobs } from '../src/projects/clone/clone-jobs.ts';
import { listProjects } from '../src/projects/projects.ts';
import { saveReposFolders, sparkReposRules } from '../src/projects/repos-folders.ts';
import { saveRemoteSwitches } from '../src/remote/store.ts';
import {
  exists,
  gitHubWorld,
  removeWorld,
  stallingGit,
  testCloneJobs,
  type GitHubWorld,
} from './github-repo-support.ts';
import {
  answerCard,
  cardResult,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let world: GitHubWorld;
let t: TestDb;
let recorded: RecordedHooks;
let tools: SparkToolsHarness;
let chat: { conversationId: string; runId: string };
let repos: string;
const realHomeEnv = process.env.HOME;

interface Asked {
  outcome: string;
  approvalId: string;
}

beforeAll(async () => {
  world = await gitHubWorld();
  process.env.HOME = world.home;
});

afterAll(async () => {
  process.env.HOME = realHomeEnv;
  await removeWorld(world);
});

async function open(clones: CloneJobs): Promise<void> {
  tools = await startSparkTools(
    t,
    { conversationId: chat.conversationId, runId: chat.runId, actions: recorded.hooks },
    { clones: () => clones, researchCopies: world.research },
  );
}

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  chat = await startChat(t, 'clone acme/widgets and work on it');
  await t.db.query(
    `UPDATE runs SET provider = 'claude', agent_mode = 'bypassPermissions',
       used_mode = 'bypassPermissions' WHERE id = $1`,
    [chat.runId],
  );
  repos = await mkdtemp(path.join(world.home, 'code-'));
  await saveReposFolders(t.db, t.workspaceId, [repos], sparkReposRules());
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

const clone = () => tools.call('spark_clone_repo', { repo: 'acme/widgets' });

async function projectNames(): Promise<string[]> {
  return (await listProjects(t.db, t.workspaceId)).map((project) => project.name);
}

describe('spark_clone_repo', () => {
  it('asks even in Bypass permissions, then clones into the repos folder and links it', async () => {
    const target = path.join(repos, 'widgets');
    await open(testCloneJobs(t, world));
    expect((await clone()).json<Asked>().outcome).toBe('waiting_for_user');
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect(card.title).toBe('Clone and link acme/widgets?');
    expect(card.payload.sparkAction).toMatchObject({ name: 'widgets', parentPath: repos });
    const done = await cardResult(t, card.id);
    expect(done.payload.sparkResult?.message).toBe(
      `Cloned acme/widgets into ~/${path.basename(repos)}/widgets and linked it. This chat can use it from your next message.`,
    );
    expect(await readFile(path.join(target, 'README.md'), 'utf8')).toContain('Widgets');
    const projects = await listProjects(t.db, t.workspaceId);
    const added = projects.find((project) => project.rootPath === target);
    expect(await conversationProjectIds(t.db, chat.conversationId)).toEqual([added!.id]);
    const again = await clone();
    expect(again.json<{ outcome: string }>().outcome).toBe('already_linked');
  });

  it('offers the same card again while one waits', async () => {
    await open(testCloneJobs(t, world));
    const first = (await clone()).json<Asked>();
    const second = (await clone()).json<Asked>();
    expect(second).toMatchObject({ outcome: 'waiting_for_user', approvalId: first.approvalId });
  });

  it('asks to link a local repo with the same origin instead of cloning', async () => {
    const local = path.join(repos, 'renamed-widgets');
    await mkdir(path.join(local, '.git'), { recursive: true });
    await writeFile(
      path.join(local, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n',
    );
    await open(testCloneJobs(t, world));
    const asked = (await clone()).json<{ outcome: string; note: string }>();
    expect(asked.outcome).toBe('waiting_for_user');
    expect(asked.note).toContain('already on this Mac');
    const card = await pendingCard(t);
    expect(card.payload.sparkAction?.action).toBe('link_repo');
    await answerCard(t, SPARK_ACTION_OPTION.decline);
  });

  it('picks owner-name when the repos folder already has a folder of that name', async () => {
    await mkdir(path.join(repos, 'widgets', 'notes'), { recursive: true });
    await open(testCloneJobs(t, world));
    await clone();
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect(card.payload.sparkAction).toMatchObject({ name: 'acme-widgets' });
    await cardResult(t, card.id);
    expect(await exists(path.join(repos, 'acme-widgets', 'README.md'))).toBe(true);
    expect(await exists(path.join(repos, 'widgets', 'notes'))).toBe(true);
  });

  it('leaves no folder or project when Spark stops the clone midway', async () => {
    const clones = testCloneJobs(t, world, await stallingGit(world));
    await open(clones);
    await clone();
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const target = path.join(repos, 'widgets');
    await eventually(() => exists(path.join(target, '.git', 'partial')), 10_000);
    clones.stopAll();
    const done = await cardResult(t, card.id);
    expect(done.payload.sparkResult?.state).toBe('failed');
    expect(done.payload.sparkResult?.message).toContain('nothing was added');
    expect(await exists(target)).toBe(false);
    expect(await projectNames()).not.toContain(path.basename(target));
    expect(await conversationProjectIds(t.db, chat.conversationId)).toEqual([]);
  });

  it('refuses a turn from a paired device unless its switch is on', async () => {
    await open(testCloneJobs(t, world));
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [
      chat.runId,
      randomUUID(),
    ]);
    await saveRemoteSwitches(t.db, t.workspaceId, { projects: false });
    const refused = await clone();
    expect(refused.text).toContain('Link a new folder or clone a repo');
    await saveRemoteSwitches(t.db, t.workspaceId, { projects: true });
    expect((await clone()).json<Asked>().outcome).toBe('waiting_for_user');
  });
});
