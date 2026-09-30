import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCodeScanner } from '../src/codescan/scanner.ts';
import { createMapBuilder, type MapSchedulerOptions } from '../src/map/scheduler.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { jsonResponse } from './app-support.ts';
import type { TestDb } from './support.ts';

export interface JevRequest {
  state: Record<string, unknown>;
  questions: Record<string, { criteria: Record<string, unknown> }>;
}

export type JevAnswerer = (request: JevRequest) => Record<string, string>;

export const firstOptions: JevAnswerer = (request) =>
  Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => [
      key,
      key === 'category' ? 'core' : (Object.keys(question.criteria)[0] ?? ''),
    ]),
  );

export function fakeJev(answer: JevAnswerer = firstOptions, onCall?: () => Promise<void>) {
  const requests: JevRequest[] = [];
  const fetchJev: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as JevRequest;
    requests.push(body);
    await onCall?.();
    const chosen = answer(body);
    const answers = Object.fromEntries(
      Object.entries(chosen).map(([key, choice]) => [
        key,
        { type: 'choice', choice, probabilities: { [choice]: 0.92 }, confidence: 0.92 },
      ]),
    );
    return jsonResponse(200, { model: 'jev-1.13.0', answers, usage: { input_tokens: 1000 } });
  };
  return { requests, fetch: fetchJev };
}

export async function writeRepo(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-map-')));
  await writeFiles(root, files);
  git(root, 'init', '-q');
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-qm', 'base');
  return root;
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

export function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
}

export async function addProject(t: TestDb, root: string, name = 'app'): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
    [id, t.workspaceId, name, root],
  );
  return id;
}

export async function connectJev(t: TestDb): Promise<void> {
  await t.db.query(
    `INSERT INTO advisor_connections (workspace_id, advisor, method, detail, models, model, verified_at)
     VALUES ($1, 'jev', 'api_key', '…test', '[]', 'jev-latest', now())`,
    [t.workspaceId],
  );
}

export function mapBuilder(
  t: TestDb,
  fetchJev: typeof fetch,
  options: Partial<MapSchedulerOptions> = {},
) {
  const scanner = createCodeScanner(t.db);
  const builder = createMapBuilder({
    db: t.db,
    scanner,
    jev: {
      db: t.db,
      secrets: memorySecretStore({ jev: 'jev-test-key' }),
      fetch: fetchJev,
      baseUrl: 'https://typesafe.test',
    },
    pollMs: 20,
    budget: 1,
    checkEveryMs: 0,
    busyCheckMs: 0,
    ...options,
  });
  return { builder, scanner };
}
