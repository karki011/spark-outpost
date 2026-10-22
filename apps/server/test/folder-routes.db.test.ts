import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Project, ProjectGit } from '@spark-outpost/contracts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let mac: ReturnType<typeof localClient>;
let base: string;
let home: string;
const realHomeEnv = process.env.HOME;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-folder-routes-')));
  home = join(base, 'home');
  await mkdir(join(home, 'Code'), { recursive: true });
  process.env.HOME = home;
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

describe('POST /api/folders', () => {
  it('makes a new folder that can then be added as a project', async () => {
    const made = await mac
      .send('post', '/api/folders', { parent: join(home, 'Code'), name: ' invoice-tool ' })
      .expect(201);
    const path = (made.body as { path: string }).path;
    expect(path).toBe(join(home, 'Code', 'invoice-tool'));
    expect((await stat(path)).isDirectory()).toBe(true);
    const project = await mac.send('post', '/api/projects', { rootPath: path }).expect(201);
    expect((project.body as Project).name).toBe('invoice-tool');
  });

  it('refuses names and parents that leave the home folder', async () => {
    const parent = join(home, 'Code');
    for (const name of ['..', '../escape', '.hidden', 'a:b', '']) {
      const response = await mac.send('post', '/api/folders', { parent, name }).expect(400);
      expect([name, typeof (response.body as { error: string }).error]).toEqual([name, 'string']);
    }
    await mac.send('post', '/api/folders', { parent: base, name: 'outside' }).expect(400);
    await mac.send('post', '/api/folders', { parent: '/', name: 'outside' }).expect(400);
    await mac.send('post', '/api/folders', { parent: 'Code', name: 'relative' }).expect(400);
  });

  it('refuses a folder that is already there', async () => {
    await mkdir(join(home, 'Code', 'taken'));
    const response = await mac
      .send('post', '/api/folders', { parent: join(home, 'Code'), name: 'taken' })
      .expect(400);
    expect((response.body as { error: string }).error).toBe('“taken” is already there.');
  });

  it('still refuses the home folder itself as a project', async () => {
    await mac.send('post', '/api/projects', { rootPath: home }).expect(400);
  });
});

describe('making a project a git repository', () => {
  it('reports a plain folder, makes it a repository once, and refuses a second time', async () => {
    const folder = join(home, 'Code', 'plain');
    await mkdir(folder);
    const created = await mac.send('post', '/api/projects', { rootPath: folder }).expect(201);
    const id = (created.body as Project).id;
    const before = await mac.get(`/api/projects/${id}/git`).expect(200);
    expect((before.body as ProjectGit).repository).toBe(false);

    const made = await mac.send('post', `/api/projects/${id}/git-init`).expect(200);
    expect((made.body as ProjectGit).repository).toBe(true);
    expect((await stat(join(folder, '.git'))).isDirectory()).toBe(true);
    const after = await mac.get(`/api/projects/${id}/git`).expect(200);
    expect(after.body).toEqual(made.body);

    const again = await mac.send('post', `/api/projects/${id}/git-init`).expect(400);
    expect((again.body as { error: string }).error).toBe(
      'This folder is already a git repository.',
    );
  });
});
