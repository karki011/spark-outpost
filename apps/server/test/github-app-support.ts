import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type request from 'supertest';
import { expect, vi, type MockInstance } from 'vitest';
import { z } from 'zod';
import {
  githubAppSignInSchema,
  githubConnectionSchema,
  shipResultSchema,
  taskOverviewSchema,
} from '@spark-outpost/contracts';
import { getRun } from '../src/persistence/runs.ts';
import { snapshotRun } from '../src/projects/run-changes.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import type { GitHubDeps } from '../src/ship/github/access.ts';
import type { GitHubAppConfig } from '../src/ship/github/app-config.ts';
import { forgetAppTokens } from '../src/ship/github/app-tokens.ts';
import { forgetPrRoutes } from '../src/ship/route-check.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { APP_CLIENT_ID, APP_SLUG, APP_USER_CODE } from './fake-github-app.ts';
import {
  FAKE_GH,
  repoWithRemote,
  startGitHubStub,
  write,
  type GitHubStub,
} from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const detailSchema = z.object({ tasks: z.array(taskOverviewSchema) });
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug'] as const;

export interface AppWorld {
  t: TestDb;
  stub: GitHubStub;
  secrets: SecretStore;
  base: string;
  ghState: string;
  appConfig: GitHubAppConfig;
  sleeps: number[];
  deps(now?: () => number): GitHubDeps;
  get(url: string): request.Test;
  post(url: string, body?: object): request.Test;
  del(url: string): request.Test;
  close(): Promise<void>;
}

export async function startAppWorld(options: { configured?: boolean } = {}): Promise<AppWorld> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-github-app-')));
  const ghState = path.join(base, 'gh-state');
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState;
  const t = await createTestDb();
  const stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  const secrets = memorySecretStore();
  forgetPrRoutes();
  forgetAppTokens(t.workspaceId);
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  const worker: Worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
  const appConfig = { clientId: APP_CLIENT_ID, slug: APP_SLUG, loginUrl: stub.url };
  const sleeps: number[] = [];
  const app = createTestApp(t, {
    secrets,
    runCommand,
    fetch,
    githubApiUrl: stub.url,
    locateGh: async () => FAKE_GH,
    githubApp: options.configured === false ? null : appConfig,
    githubSignInSleep: async (ms) => {
      sleeps.push(ms);
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  });
  const send = (method: 'post' | 'delete', url: string, body: object) =>
    localClient(app).send(method, url, body);
  return {
    t,
    stub,
    secrets,
    base,
    ghState,
    appConfig,
    sleeps,
    deps: (now) => ({
      db: t.db,
      workspaceId: t.workspaceId,
      secrets,
      runCommand,
      fetch,
      apiUrl: stub.url,
      locateGh: async () => FAKE_GH,
      app: appConfig,
      now,
    }),
    get: (url) => localClient(app).get(url),
    post: (url, body = {}) => send('post', url, body),
    del: (url) => send('delete', url, {}),
    async close() {
      await worker.stop();
      await stub.close();
      await t.cleanup();
      await rm(base, { recursive: true, force: true });
    },
  };
}

export const signInState = async (world: AppWorld) =>
  githubAppSignInSchema.parse((await world.get('/api/github/app/sign-in').expect(200)).body);

export const connection = async (world: AppWorld) =>
  githubConnectionSchema.parse((await world.get('/api/github/connection').expect(200)).body);

export async function signIn(world: AppWorld): Promise<void> {
  world.stub.github.app.decision = 'approved';
  await world.post('/api/github/app/sign-in').expect(200);
  await eventually(async () => (await signInState(world)).status === 'connected', 10_000);
}

export async function linkedRepo(world: AppWorld, name: string) {
  const repo = await repoWithRemote(world.base, name);
  await world.post('/api/projects', { rootPath: repo.root }).expect(201);
  return repo;
}

export async function editedTask(world: AppWorld, root: string) {
  const conversationId = randomUUID();
  await world.post('/api/conversations', { id: conversationId }).expect(201);
  const sent = await world
    .post(`/api/conversations/${conversationId}/messages`, {
      id: randomUUID(),
      content: 'ABC-12 Tidy the notes #plan',
    })
    .expect(201);
  const runId = sent.body.run.id as string;
  await eventually(async () => (await getRun(world.t.db, runId))?.finishedAt, 15_000);
  const detail = detailSchema.parse(
    (await world.get(`/api/conversations/${conversationId}`).expect(200)).body,
  );
  await snapshotRun(world.t.db, runId, root);
  await write(root, 'notes.txt', 'one\ntwo\n');
  return { taskId: detail.tasks[0]!.id, conversationId };
}

export async function ship(world: AppWorld, taskId: string) {
  const response = await world.post(`/api/tasks/${taskId}/ship`, { mode: 'draft_pr' }).expect(200);
  return shipResultSchema.parse(response.body);
}

export async function everyRow(t: TestDb): Promise<string> {
  const { rows } = await t.db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  const dumps = await Promise.all(
    rows.map(async ({ table_name: table }) =>
      JSON.stringify((await t.db.query(`SELECT * FROM "${table}"`)).rows),
    ),
  );
  return dumps.join('\n');
}

export function watchConsole(): { text(): string; restore(): void } {
  const spies: MockInstance[] = CONSOLE.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  return {
    text: () => JSON.stringify(spies.flatMap((spy) => spy.mock.calls)),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

export function expectNoSecrets(text: string, world: AppWorld): void {
  expect(text).not.toMatch(/gh[ur]_[A-Za-z0-9]/);
  expect(text).not.toContain(APP_USER_CODE);
  expect(text).not.toContain('fake-device-code');
  for (const token of world.stub.github.app.issued) expect(text).not.toContain(token);
}
