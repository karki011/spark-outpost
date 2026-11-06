import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReposFolders } from '@spark-outpost/contracts';
import { browserDataDir } from '../src/approvals/browser-data.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let mac: ReturnType<typeof localClient>;
let base: string;
const realHomeEnv = process.env.HOME;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-repos-folders-')));
  process.env.HOME = base;
  for (const folder of ['code/api', 'code/web', 'work/billing', 'clones']) {
    await mkdir(join(base, folder), { recursive: true });
  }
});

afterAll(async () => {
  process.env.HOME = realHomeEnv;
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  mac = localClient(createTestApp(t));
});

afterEach(async () => {
  await t.cleanup();
});

async function folders(): Promise<ReposFolders['folders']> {
  return ((await mac.get('/api/repos-folders').expect(200)).body as ReposFolders).folders;
}

describe('repos folders', () => {
  it('suggests the folders that hold projects until the user sets their own', async () => {
    expect(await folders()).toEqual([]);
    for (const project of ['code/api', 'code/web', 'work/billing']) {
      await mac.send('post', '/api/projects', { rootPath: join(base, project) }).expect(201);
    }
    expect(await folders()).toEqual([
      { path: join(base, 'code'), displayPath: '~/code', suggested: true },
      { path: join(base, 'work'), displayPath: '~/work', suggested: true },
    ]);
    const saved = await mac
      .send('put', '/api/repos-folders', { folders: [join(base, 'clones'), base] })
      .expect(200);
    const expected = [
      { path: join(base, 'clones'), displayPath: '~/clones', suggested: false },
      { path: base, displayPath: '~', suggested: false },
    ];
    expect((saved.body as ReposFolders).folders).toEqual(expected);
    expect(await folders()).toEqual(expected);
    await mac.send('put', '/api/repos-folders', { folders: [] }).expect(200);
    expect((await folders()).every((folder) => folder.suggested)).toBe(true);
  });

  it('refuses the whole disk, a missing folder and Spark’s data folder', async () => {
    await mac.send('put', '/api/repos-folders', { folders: ['/'] }).expect(400);
    await mac.send('put', '/api/repos-folders', { folders: [join(base, 'nope')] }).expect(400);
    await mkdir(browserDataDir(), { recursive: true });
    await mac.send('put', '/api/repos-folders', { folders: [browserDataDir()] }).expect(400);
  });

  it('starts Clone a repository in the first repos folder', async () => {
    await mac.send('put', '/api/repos-folders', { folders: [join(base, 'clones')] }).expect(200);
    const options = await mac.get('/api/project-clones/options').expect(200);
    expect((options.body as { defaultParent: string }).defaultParent).toBe(join(base, 'clones'));
  });
});
