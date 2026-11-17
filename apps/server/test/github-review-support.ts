import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { resolveRunTarget } from '../src/api/run-target.ts';
import { gitHubDepsOf } from '../src/api/ship-routes.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import type { ReviewRunnerDeps } from '../src/github-inbox/review/runner.ts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN, testAppOptions } from './app-support.ts';
import { TOKEN_LOGIN, type FakePull } from './fake-github.ts';
import { repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

export const SHA = 'a'.repeat(40);
export const NEW_SHA = 'b'.repeat(40);

export interface ReviewWorld {
  t: TestDb;
  github: GitHubStub;
  secrets: SecretStore;
  app: ReturnType<typeof createTestApp>;
  base: string;
  clock: { now: number };
  deps: ReviewRunnerDeps;
  projectId: string;
  close(): Promise<void>;
}

export async function reviewWorld(fixedRunProvider: string | null = 'fake'): Promise<ReviewWorld> {
  const t = await createTestDb();
  const github = await startGitHubStub();
  const secrets = memorySecretStore();
  const base = await realpath(await mkdtemp(join(tmpdir(), 'spark-github-review-')));
  const options = { secrets, fetch, githubApiUrl: github.url, fixedRunProvider };
  const app = createTestApp(t, options);
  const clock = { now: Date.now() };
  await secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: TOKEN_LOGIN,
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
  const repo = await repoWithRemote(base, 'widgets');
  const created = await request(app)
    .post('/api/projects')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ rootPath: repo.root })
    .expect(201);
  const deps: ReviewRunnerDeps = {
    db: t.db,
    workspaceId: t.workspaceId,
    store: workflowStore(),
    github: { ...gitHubDepsOf(testAppOptions(t, options)), now: () => clock.now },
    runTarget: (conversationId) =>
      resolveRunTarget(
        { db: t.db, workspaceId: t.workspaceId, fixedRunProvider: fixedRunProvider ?? undefined },
        conversationId,
      ),
    now: () => new Date(clock.now),
  };
  return {
    t,
    github,
    secrets,
    app,
    base,
    clock,
    deps,
    projectId: (created.body as { id: string }).id,
    async close() {
      await github.close();
      await t.cleanup();
      await rm(base, { recursive: true, force: true });
    },
  };
}

export function addPull(world: ReviewWorld, number: number, fields: Partial<FakePull> = {}) {
  const pull: FakePull = {
    number,
    owner: 'acme',
    repo: 'widgets',
    title: `Change ${number}`,
    body: `Body of ${number}`,
    head: `change-${number}`,
    base: 'main',
    draft: false,
    state: 'open',
    html_url: `https://github.com/acme/widgets/pull/${number}`,
    openedBy: 'alice',
    requestedReviewers: [TOKEN_LOGIN],
    via: 'token',
    sha: SHA,
    updated_at: new Date().toISOString(),
    files: [
      {
        filename: 'src/app.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ],
    ...fields,
  };
  world.github.github.pulls.push(pull);
  return pull;
}

export function send(
  world: ReviewWorld,
  method: 'put' | 'post' | 'get',
  url: string,
  body: object = {},
) {
  const call = request(world.app)[method](url).set(LOCAL_HEADERS);
  return method === 'get' ? call : call.set('Origin', ORIGIN).send(body);
}
