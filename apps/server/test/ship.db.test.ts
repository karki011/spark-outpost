import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  githubConnectionSchema,
  shipPreviewSchema,
  shipResultSchema,
  taskOverviewSchema,
} from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { HARNESS_COMMIT_EMAIL } from '../src/projects/snapshot.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { TOKEN_LOGIN } from './fake-github.ts';
import {
  FAKE_GH,
  git,
  repoWithRemote,
  startGitHubStub,
  write,
  type GitHubStub,
} from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });
const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-ship-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  secrets = memorySecretStore();
  await rm(ghState(), { force: true });
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
  const { runCommand } = await import('../src/setup/command.ts');
  app = createTestApp(t, {
    secrets,
    runCommand,
    fetch,
    githubApiUrl: stub.url,
    locateGh: async () => FAKE_GH,
  });
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function loginGh(login = 'octo-cli') {
  await writeFile(ghState(), login);
}

const post = (url: string, body: object) =>
  request(app).post(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const put = (url: string, body: object) =>
  request(app).put(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const del = (url: string) =>
  request(app).delete(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send({});
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function taskWithRun(content = 'Tidy the notes #plan') {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content,
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 15_000);
  const detail = detailSchema.parse(
    (await get(`/api/conversations/${conversationId}`).expect(200)).body,
  );
  return { taskId: detail.tasks[0]!.id, runId };
}

async function preview(taskId: string) {
  return shipPreviewSchema.parse((await get(`/api/tasks/${taskId}/ship`).expect(200)).body);
}

async function ship(taskId: string, body: object, status = 200) {
  const response = await post(`/api/tasks/${taskId}/ship`, body).expect(status);
  return status === 200 ? shipResultSchema.parse(response.body) : response.body;
}

async function editedTask(root: string) {
  const { taskId, runId } = await taskWithRun();
  await snapshotRun(t.db, runId, root);
  await write(root, 'notes.txt', 'one\ntwo\n');
  await write(root, 'src/new.ts', 'export const x = 1;\n');
  await write(root, '.env', 'SECRET=1\n');
  return { taskId, runId };
}

describe('ship', () => {
  it('commits only the task files on its branch, pushes and opens one draft PR through gh', async () => {
    const repo = await repoWithRemote(base, 'gh');
    await loginGh();
    await write(repo.root, 'mine.txt', 'my own edit\n');
    await write(repo.root, 'staged.txt', 'staged by me\n');
    git(repo.root, 'add', 'staged.txt');
    const { taskId, runId } = await editedTask(repo.root);

    const before = await preview(taskId);
    expect(before.blocked).toBeNull();
    expect(before.branch).toMatch(new RegExp(`^spark/tidy-the-notes-plan-${taskId.slice(0, 8)}$`));
    expect(before.baseBranch).toBe('main');
    expect(before.files).toEqual([
      { path: 'notes.txt', change: 'modified' },
      { path: 'src/new.ts', change: 'added' },
    ]);
    expect(before.skipped.map((file) => file.path)).toEqual(['.env']);
    expect(before.modes).toEqual(['commit', 'push', 'draft_pr']);
    expect(before.remote).toEqual({
      name: 'origin',
      host: 'github.com',
      repo: 'acme/widgets',
      github: true,
    });
    expect(before.github).toEqual({ method: 'gh_cli', host: 'github.com' });

    const result = await ship(taskId, { mode: 'draft_pr', title: 'Tidy the notes' });
    expect(result).toMatchObject({
      branch: before.branch,
      pushed: true,
      committedFiles: ['notes.txt', 'src/new.ts'],
      pullRequest: { number: 1, created: true, url: 'https://github.com/acme/widgets/pull/1' },
      link: { kind: 'pr', source: 'ship', title: 'acme/widgets#1' },
    });

    expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe(before.branch);
    expect(git(repo.root, 'show', '--name-only', '--format=', 'HEAD').split('\n')).toEqual([
      'notes.txt',
      'src/new.ts',
    ]);
    expect(git(repo.root, 'log', '-1', '--format=%an <%ae>|%s')).toBe(
      'Test Person <test@example.test>|Tidy the notes',
    );
    expect(git(repo.root, 'diff', '--name-only')).toBe('mine.txt');
    expect(git(repo.root, 'diff', '--cached', '--name-only')).toBe('staged.txt');
    expect(git(repo.root, 'ls-files', '--others')).toBe('.env');
    expect(git(repo.bare, 'rev-parse', `refs/heads/${before.branch}`)).toBe(
      git(repo.root, 'rev-parse', 'HEAD'),
    );
    expect(git(repo.bare, 'rev-parse', 'refs/heads/main')).toBe(
      git(repo.root, 'rev-parse', 'main'),
    );

    const pull = stub.github.pulls[0]!;
    expect(pull).toMatchObject({ draft: true, base: 'main', head: before.branch, via: 'gh_cli' });
    expect(pull.body).toContain('- `notes.txt` (modified)');
    expect(pull.body).toContain('No project checks ran.');
    expect(pull.body.endsWith('🤖 Generated with Spark Outpost')).toBe(true);

    const { rows } = await t.db.query<{ method: string; payload: { pullRequest: unknown } }>(
      `SELECT method, payload FROM run_protocol_log WHERE run_id = $1 AND kind = 'ship'`,
      [runId],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        method: 'ship/draft_pr',
        payload: expect.objectContaining({ outcome: 'succeeded', github: 'gh_cli' }),
      }),
    ]);

    await write(repo.root, 'notes.txt', 'one\ntwo\nthree\n');
    const again = await ship(taskId, { mode: 'draft_pr', title: 'Tidy the notes, again' });
    expect(again.pullRequest).toMatchObject({ number: 1, created: false });
    expect(again.committedFiles).toEqual(['notes.txt']);
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]!.title).toBe('Tidy the notes, again');
    expect(git(repo.root, 'rev-list', '--count', `main..${before.branch}`)).toBe('2');

    const quiet = await ship(taskId, { mode: 'draft_pr' });
    expect(quiet).toMatchObject({
      commit: null,
      committedFiles: [],
      pullRequest: { created: false },
    });
    const links = await get(`/api/tasks/${taskId}`).expect(200);
    const shipLinks = (links.body.links as { source: string }[]).filter(
      (link) => link.source === 'ship',
    );
    expect(shipLinks).toHaveLength(1);
    expect((await preview(taskId)).shipped).toMatchObject({
      branch: before.branch,
      pullRequest: { number: 1 },
    });
  });

  it('never force-pushes over a branch that moved on the remote', async () => {
    const repo = await repoWithRemote(base, 'diverged');
    const { taskId } = await editedTask(repo.root);
    const branch = (await preview(taskId)).branch;
    const other = path.join(base, 'diverged-other');
    git(base, 'clone', '-q', repo.bare, other);
    git(other, 'switch', '-q', '-c', branch);
    await write(other, 'theirs.txt', 'theirs\n');
    git(other, 'add', '.');
    git(other, '-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-qm', 'theirs');
    git(other, 'push', '-q', 'origin', branch);
    const theirs = git(other, 'rev-parse', 'HEAD');

    const failed = await ship(taskId, { mode: 'push' }, 409);
    expect(failed.error).toMatch(/^Pushing .* failed/);
    expect(git(repo.bare, 'rev-parse', `refs/heads/${branch}`)).toBe(theirs);
  });

  it("never pushes a branch that carries Spark Outpost's internal commits", async () => {
    const repo = await repoWithRemote(base, 'internal');
    const { taskId } = await editedTask(repo.root);
    const branch = (await preview(taskId)).branch;
    git(repo.root, 'switch', '-q', '-c', branch);
    const internal = git(
      repo.root,
      '-c',
      'user.name=Spark Outpost',
      '-c',
      `user.email=${HARNESS_COMMIT_EMAIL}`,
      'commit-tree',
      'HEAD^{tree}',
      '-p',
      'HEAD',
      '-m',
      'Spark Outpost: parallel base 01a0e739 solo',
    );
    git(repo.root, 'update-ref', `refs/heads/${branch}`, internal);

    const failed = await ship(taskId, { mode: 'push' }, 409);
    expect(failed.error).toContain("carries Spark Outpost's internal commits");
    expect(failed.error).toContain('parallel base 01a0e739 solo');
    expect(git(repo.bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe('main');
  });

  it('opens the PR with a saved token when gh is not logged in, and forgets it on remove', async () => {
    const repo = await repoWithRemote(base, 'token');
    await post('/api/projects', { rootPath: repo.root }).expect(201);
    const { taskId } = await editedTask(repo.root);
    expect((await preview(taskId)).modes).toEqual(['commit', 'push']);
    expect((await preview(taskId)).notes[0]).toMatch(/Connect GitHub in Settings/);

    const rejected = await put('/api/github/token', {
      token: 'github_pat_rejected_0123456789abcdef',
    }).expect(400);
    expect(rejected.body.error).toMatch(/rejected this token/);

    const token = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop';
    const saved = githubConnectionSchema.parse(
      (await put('/api/github/token', { token }).expect(200)).body,
    );
    expect(saved).toMatchObject({
      active: 'token',
      ghCli: { installed: true, login: null },
      token: {
        host: 'github.com',
        login: TOKEN_LOGIN,
        scopes: [],
        expiresAt: '2026-12-31T00:00:00.000Z',
        repos: [{ repo: 'acme/widgets', access: 'push' }],
      },
    });
    expect(await secrets.get('github')).toBe(token);
    const stored = await t.db.query('SELECT * FROM github_tokens');
    expect(JSON.stringify(stored.rows)).not.toContain(token);

    const result = await ship(taskId, { mode: 'draft_pr' });
    expect(result.pullRequest?.created).toBe(true);
    expect(stub.github.pulls[0]).toMatchObject({ via: 'token', openedBy: TOKEN_LOGIN });
    const { rows } = await t.db.query<{ payload: unknown }>(
      `SELECT payload FROM run_protocol_log WHERE kind = 'ship'`,
    );
    expect(JSON.stringify(rows)).not.toContain(token);

    const removed = githubConnectionSchema.parse((await del('/api/github/token').expect(200)).body);
    expect(removed).toMatchObject({ active: null, token: null });
    expect(await secrets.get('github')).toBeNull();
  });

  it('prefers the gh login over a saved token and reports it', async () => {
    await loginGh('octo-cli');
    const status = githubConnectionSchema.parse(
      (await get('/api/github/connection').expect(200)).body,
    );
    expect(status).toEqual({
      active: 'gh_cli',
      ghCli: { installed: true, host: 'github.com', login: 'octo-cli' },
      token: null,
      app: { available: false },
    });
  });

  it('commits only when there is no remote, and refuses to push', async () => {
    const repo = await repoWithRemote(base, 'local', 'none');
    const { taskId } = await editedTask(repo.root);
    const before = await preview(taskId);
    expect(before.modes).toEqual(['commit']);
    expect(before.notes[0]).toMatch(/no remote/);
    expect((await ship(taskId, { mode: 'push' }, 409)).error).toMatch(/no remote/);
    const result = await ship(taskId, { mode: 'commit' });
    expect(result).toMatchObject({ pushed: false, pullRequest: null, link: null });
    expect(git(repo.root, 'log', '-1', '--format=%s')).toBe('Tidy the notes #plan');
  });

  it('explains why it cannot ship', async () => {
    const plain = path.join(base, 'plain');
    await write(plain, 'a.txt', 'a\n');
    const outside = await taskWithRun();
    await snapshotRun(t.db, outside.runId, plain);
    await write(plain, 'a.txt', 'b\n');
    expect((await preview(outside.taskId)).blocked).toEqual({
      reason: 'not_repo',
      message: expect.stringMatching(/isn’t a Git repository/),
    });
    expect((await ship(outside.taskId, { mode: 'commit' }, 409)).error).toMatch(/Git repository/);

    const repo = await repoWithRemote(base, 'switched');
    const { taskId } = await editedTask(repo.root);
    await ship(taskId, { mode: 'commit' });
    git(repo.root, 'switch', '-q', 'main');
    await write(repo.root, 'notes.txt', 'on main\n');
    expect((await preview(taskId)).blocked?.message).toMatch(/Switch to spark\//);

    const empty = await taskWithRun('Nothing here #plan');
    expect((await preview(empty.taskId)).blocked).toEqual({
      reason: 'no_changes',
      message: 'This task has no file changes to ship.',
    });
    await get(`/api/tasks/${randomUUID()}/ship`).expect(404);
  });
});
