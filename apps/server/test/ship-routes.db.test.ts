import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  chatPrRouteSchema,
  githubConnectionSchema,
  githubTestResultSchema,
  shipPreviewSchema,
  shipResultSchema,
  taskOverviewSchema,
} from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { forgetPrRoutes } from '../src/ship/route-check.ts';
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

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop';

let t: TestDb;
let worker: Worker;
let base: string;
let stub: GitHubStub;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;

const ghState = () => path.join(base, 'gh-state');
const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-ship-routes-')));
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
  forgetPrRoutes();
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

const post = (url: string, body: object) =>
  request(app).post(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const put = (url: string, body: object) =>
  request(app).put(url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function editedTask(root: string) {
  const conversationId = randomUUID();
  await post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await post(`/api/conversations/${conversationId}/messages`, {
    id: randomUUID(),
    content: 'ABC-12 Tidy the notes #plan',
  }).expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(t.db, runId))?.finishedAt, 15_000);
  const detail = detailSchema.parse(
    (await get(`/api/conversations/${conversationId}`).expect(200)).body,
  );
  await snapshotRun(t.db, runId, root);
  await write(root, 'notes.txt', 'one\ntwo\n');
  return { taskId: detail.tasks[0]!.id, conversationId };
}

async function ship(taskId: string) {
  const response = await post(`/api/tasks/${taskId}/ship`, { mode: 'draft_pr' }).expect(200);
  return shipResultSchema.parse(response.body);
}

async function shipAudit() {
  const { rows } = await t.db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM run_protocol_log WHERE kind = 'ship' ORDER BY at DESC LIMIT 1`,
  );
  return rows[0]?.payload ?? null;
}

async function linkedRepo(name: string) {
  const repo = await repoWithRemote(base, name);
  await post('/api/projects', { rootPath: repo.root }).expect(201);
  return repo;
}

describe('the pull request route chain', { timeout: 60_000 }, () => {
  it('prefers the GitHub connection over the gh login, and falls back to gh when it is refused', async () => {
    const repo = await linkedRepo('token-first');
    await writeFile(ghState(), 'octo-cli');
    await put('/api/github/token', { token: TOKEN }).expect(200);
    const status = githubConnectionSchema.parse((await get('/api/github/connection')).body);
    expect(status.active).toBe('token');

    const first = await editedTask(repo.root);
    expect((await ship(first.taskId)).pullRequest?.created).toBe(true);
    expect(stub.github.pulls[0]).toMatchObject({ via: 'token', openedBy: TOKEN_LOGIN });
    expect(stub.github.pulls[0]!.title).toContain('ABC-12');

    await secrets.set('github', 'github_pat_rejected_0123456789abcdef');
    const second = await editedTask(repo.root);
    const fallback = await ship(second.taskId);
    expect(fallback.pullRequest).toMatchObject({ number: 1, created: false });
    expect(fallback.prLink ?? null).toBeNull();
  });

  it('pushes and gives a Create PR link when GitHub is not connected', async () => {
    const repo = await linkedRepo('compare');
    const { taskId } = await editedTask(repo.root);
    const preview = shipPreviewSchema.parse((await get(`/api/tasks/${taskId}/ship`)).body);
    expect(preview.modes).toContain('draft_pr');
    expect(preview.notes[0]).toMatch(/Create PR link/);

    const result = await ship(taskId);
    expect(result.pushed).toBe(true);
    expect(result.pullRequest).toBeNull();
    expect(stub.github.pulls).toEqual([]);
    const link = new URL(result.prLink!.url);
    expect(link.pathname).toBe(`/acme/widgets/compare/main...${encodeURIComponent(result.branch)}`);
    expect(link.searchParams.get('title')).toContain('ABC-12');
    expect(result.link).toMatchObject({ kind: 'link', title: 'Create PR on GitHub' });
    expect(git(repo.bare, 'rev-parse', result.branch)).toBe(
      git(repo.root, 'rev-parse', result.branch),
    );
  });

  it('pushes to a GitLab remote and links its merge request page', async () => {
    const repo = await linkedRepo('gitlab');
    git(repo.root, 'remote', 'set-url', 'origin', 'https://gitlab.com/acme/widgets.git');
    const { taskId } = await editedTask(repo.root);
    const result = await ship(taskId);
    expect(result.pushed).toBe(true);
    expect(result.prLink).toMatchObject({ label: 'Create merge request on GitLab' });
    expect(result.prLink!.url).toMatch(
      /^https:\/\/gitlab\.com\/acme\/widgets\/-\/merge_requests\/new\?/,
    );
  });

  it('retries a push the git login could not make with the GitHub connection, without leaking it', async () => {
    const repo = await linkedRepo('askpass');
    await put('/api/github/token', { token: TOKEN }).expect(200);
    const hook = path.join(repo.bare, 'hooks', 'pre-receive');
    await writeFile(
      hook,
      `#!/bin/sh
if [ -n "$GIT_ASKPASS" ] && [ "$("$GIT_ASKPASS" 'Password for https://github.com:')" = "${TOKEN}" ]; then exit 0; fi
echo "fatal: Authentication failed for 'https://github.com/acme/widgets.git/'" >&2
exit 1
`,
    );
    await chmod(hook, 0o755);
    const { taskId } = await editedTask(repo.root);
    const result = await ship(taskId);
    expect(result.pushed).toBe(true);
    const audit = await shipAudit();
    expect(audit).toMatchObject({ pushedWith: 'token' });
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
    expect(git(repo.root, 'config', '--list')).not.toContain(TOKEN);
  });

  it('says how to push by hand when no login works', async () => {
    const repo = await linkedRepo('nologin');
    const hook = path.join(repo.bare, 'hooks', 'pre-receive');
    await writeFile(hook, '#!/bin/sh\necho "fatal: Authentication failed" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    const { taskId } = await editedTask(repo.root);
    const response = await post(`/api/tasks/${taskId}/ship`, { mode: 'push' }).expect(409);
    expect(response.body.error).toMatch(
      /Run `git -C .+ push --set-upstream origin spark\/\S+` in a terminal/,
    );
  });

  it('reports the route for a chat and dry-runs the connection from Settings', async () => {
    const repo = await linkedRepo('route');
    const { conversationId } = await editedTask(repo.root);
    const before = chatPrRouteSchema.parse(
      (await get(`/api/conversations/${conversationId}/pr-route`)).body,
    );
    expect(before.info).toEqual({ route: 'link', host: 'github.com', repo: 'acme/widgets' });

    await put('/api/github/token', { token: TOKEN }).expect(200);
    const after = chatPrRouteSchema.parse(
      (await get(`/api/conversations/${conversationId}/pr-route`)).body,
    );
    expect(after.info?.route).toBe('token');

    const heads = git(repo.bare, 'for-each-ref', '--format=%(refname)');
    const tested = githubTestResultSchema.parse((await post('/api/github/test', {})).body);
    expect(tested.projects).toEqual([
      expect.objectContaining({ remote: 'origin', route: 'token', reach: 'git' }),
    ]);
    expect(tested.projects[0]!.detail).toMatch(/signed in to github.com as/);
    expect(git(repo.bare, 'for-each-ref', '--format=%(refname)')).toBe(heads);
  });
});
