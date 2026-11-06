import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { researchCopyFolder } from '../src/chat-files/research-copies.ts';
import { pruneChatFolders } from '../src/chat-files/prune.ts';
import type { CloneJobs } from '../src/projects/clone/clone-jobs.ts';
import { saveRemoteSwitches } from '../src/remote/store.ts';
import { LOCAL_HEADERS, ORIGIN, testAppOptions } from './app-support.ts';
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

interface Copied {
  repo: string;
  path: string;
  reused: boolean;
}

beforeAll(async () => {
  world = await gitHubWorld();
});

afterAll(async () => {
  await removeWorld(world);
});

async function open(clones: CloneJobs, mode = 'bypassPermissions'): Promise<void> {
  await t.db.query(
    `UPDATE runs SET provider = 'claude', agent_mode = $2, used_mode = $2 WHERE id = $1`,
    [chat.runId, mode],
  );
  tools = await startSparkTools(
    t,
    { conversationId: chat.conversationId, runId: chat.runId, actions: recorded.hooks },
    { clones: () => clones, researchCopies: world.research },
  );
}

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  chat = await startChat(t, 'how does acme/widgets count widgets?');
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

const copy = (args: Record<string, unknown> = {}) =>
  tools.call('spark_research_repo', { repo: 'acme/widgets', ...args });

function gitOut(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

describe('spark_research_repo', () => {
  it('makes a shallow copy with no hooks or submodules and reuses it in the chat', async () => {
    execFileSync(
      'git',
      [
        '-c',
        `init.templateDir=${world.templates}`,
        'clone',
        '-q',
        `file://${world.sources}/acme/widgets.git`,
        'control',
      ],
      { cwd: world.base },
    );
    expect(await exists(world.hookMark)).toBe(true);
    execFileSync('rm', ['-f', world.hookMark]);
    await open(testCloneJobs(t, world));
    const first = (await copy()).json<Copied>();
    expect(first).toMatchObject({ repo: 'acme/widgets', reused: false });
    expect(first.path).toBe(
      researchCopyFolder(world.research, chat.conversationId, 'acme/widgets'),
    );
    expect(await readFile(path.join(first.path, 'src', 'index.ts'), 'utf8')).toContain('widgets');
    expect(gitOut(first.path, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(gitOut(first.path, 'branch', '-r')).not.toContain('other');
    expect(await readdir(path.join(first.path, 'vendor', 'sub'))).toEqual([]);
    expect(await exists(world.hookMark)).toBe(false);
    const again = (await copy()).json<Copied>();
    expect(again).toMatchObject({ path: first.path, reused: true });
    const fresh = (await copy({ refresh: true })).json<Copied>();
    expect(fresh).toMatchObject({ path: first.path, reused: false });
    expect(recorded.audited).toContainEqual(
      expect.objectContaining({ method: 'spark/github_read' }),
    );
  });

  it('asks in Manual and returns the path in the same call once allowed', async () => {
    await open(testCloneJobs(t, world), 'default');
    const call = copy();
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect(card.title).toBe('Let the agent copy acme/widgets to read it?');
    const copied = (await call).json<Copied>();
    expect(await exists(path.join(copied.path, 'README.md'))).toBe(true);
    const later = (await copy({ refresh: true })).json<Copied>();
    expect(later.reused).toBe(false);
    const { rows } = await t.db.query(`SELECT 1 FROM approvals WHERE kind = 'spark_action'`);
    expect(rows).toHaveLength(1);
  });

  it('makes one copy when the same repo is asked for twice at once', async () => {
    const clones = testCloneJobs(t, world);
    await open(clones);
    const [first, second] = await Promise.all([copy({ refresh: true }), copy({ refresh: true })]);
    expect(first.json<Copied>().path).toBe(second.json<Copied>().path);
    expect(await exists(path.join(first.json<Copied>().path, 'README.md'))).toBe(true);
    expect(clones.list()).toHaveLength(1);
  });

  it('asks before searching GitHub in Manual and says so when the user declines', async () => {
    await open(testCloneJobs(t, world), 'default');
    const call = tools.call('spark_github_repos', { query: 'widgets' });
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline);
    expect(card.title).toBe('Let the agent search your GitHub repositories?');
    expect((await call).json<{ outcome: string; message: string }>()).toEqual({
      outcome: 'declined',
      message:
        'The user did not let you read your GitHub repositories. Do not try again unless they ask.',
    });
  });

  it('stops the copy and removes its folder when the turn is stopped', async () => {
    const clones = testCloneJobs(t, world, await stallingGit(world));
    await open(clones);
    const call = copy();
    const folder = researchCopyFolder(world.research, chat.conversationId, 'acme/widgets');
    await eventually(() => exists(path.join(folder, '.git', 'partial')), 10_000);
    recorded.stop();
    const stopped = await call;
    expect(stopped.text).toMatch(/still copying|could not copy/);
    await eventually(async () => !(await exists(folder)), 10_000);
    expect(clones.list().every((job) => job.status !== 'cloning')).toBe(true);
  });

  it('refuses a turn from a paired device unless its switch is on', async () => {
    await open(testCloneJobs(t, world));
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [
      chat.runId,
      randomUUID(),
    ]);
    await saveRemoteSwitches(t.db, t.workspaceId, { projects: false });
    const refused = await copy();
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Link a new folder or clone a repo');
  });

  it('refuses something that is not owner/name', async () => {
    await open(testCloneJobs(t, world));
    expect((await copy({ repo: '../etc' })).text).toContain('owner/name');
  });
});

describe('research copies when a chat goes away', () => {
  it('are deleted with the chat and swept when their chat is gone', async () => {
    await open(testCloneJobs(t, world));
    const kept = (await copy()).json<Copied>();
    const gone = researchCopyFolder(world.research, randomUUID(), 'acme/widgets');
    execFileSync('mkdir', ['-p', gone]);
    expect(await pruneChatFolders(t.db, world.research)).toBeGreaterThan(0);
    expect(await exists(gone)).toBe(false);
    expect(await exists(kept.path)).toBe(true);
    const app = createApp({ ...testAppOptions(t), researchCopies: world.research });
    await request(app)
      .delete(`/api/conversations/${chat.conversationId}`)
      .connect('::1')
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .expect(204);
    expect(await exists(kept.path)).toBe(false);
  });
});
