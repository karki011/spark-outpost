import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cloneJobSchema,
  cloneJobsSchema,
  projectSchema,
  type CloneJob,
  type Project,
} from '@spark-outpost/contracts';
import { cloneJobsFor, type CloneTestOverrides } from '../src/api/project-clone-routes.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  cloneWorld,
  PLANTED_TOKEN,
  refusingGit,
  stallingGit,
  tokenOnlyGit,
  tokenRecord,
  treeText,
  type CloneWorld,
} from './clone-support.ts';
import { everyRow, watchConsole } from './github-app-support.ts';
import { git } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let world: CloneWorld;
let client: ReturnType<typeof localClient>;

function open(overrides: Partial<CloneTestOverrides> = {}) {
  client = localClient(createTestApp(t, { cloneTest: { root: world.home, ...overrides } }));
}

beforeEach(async () => {
  t = await createTestDb();
  world = await cloneWorld();
  open();
});

afterEach(async () => {
  for (const job of await jobs()) {
    if (job.status === 'cloning') await client.send('post', `/api/project-clones/${job.id}/cancel`);
  }
  await t.cleanup();
  await rm(world.base, { recursive: true, force: true });
});

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

const start = (name = 'widgets', url = world.sourceUrl, parentPath = world.documents) =>
  client.send('post', '/api/project-clones', { url, parentPath, name });

async function jobs(): Promise<CloneJob[]> {
  return cloneJobsSchema.parse((await client.get('/api/project-clones').expect(200)).body).jobs;
}

async function settled(id: string): Promise<CloneJob> {
  let found: CloneJob | undefined;
  await eventually(async () => {
    found = (await jobs()).find((job) => job.id === id);
    return found !== undefined && found.status !== 'cloning';
  }, 15_000);
  return found!;
}

async function projects(): Promise<Project[]> {
  return projectSchema.array().parse((await client.get('/api/projects').expect(200)).body);
}

async function markerCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: string }>('SELECT count(*) FROM project_clones');
  return Number(rows[0]!.count);
}

async function startStalled(name = 'widgets'): Promise<CloneJob> {
  const job = cloneJobSchema.parse((await start(name).expect(202)).body);
  await eventually(() => exists(path.join(world.documents, name, '.git', 'partial')), 10_000);
  return job;
}

describe('cloning a repository into a new project', () => {
  it('clones, links the folder like a chosen folder, and leaves no marker', async () => {
    const started = cloneJobSchema.parse((await start().expect(202)).body);
    expect(started).toMatchObject({ status: 'cloning', project: null, failure: null });
    const done = await settled(started.id);
    const target = path.join(world.documents, 'widgets');
    expect(done).toMatchObject({ status: 'done', percent: 100, destination: target });
    expect(await readFile(path.join(target, 'README.md'), 'utf8')).toBe('# Widgets\n');
    expect(git(target, 'remote', 'get-url', 'origin')).toBe(world.sourceUrl);

    const picked = path.join(world.home, 'picked');
    await mkdir(picked);
    const linked = projectSchema.parse(
      (await client.send('post', '/api/projects', { rootPath: picked }).expect(201)).body,
    );
    const cloned = (await projects()).find((project) => project.rootPath === target)!;
    expect(done.project?.id).toBe(cloned.id);
    const defaults = ({ id: _id, name: _name, rootPath: _root, ...rest }: Project) => ({
      ...rest,
      displayPath: '',
      createdAt: '',
      lastUsedAt: '',
    });
    expect(defaults(cloned)).toEqual(defaults(linked));
    expect(cloned.name).toBe('widgets');
    expect(await markerCount()).toBe(0);
  });

  it('refuses an existing folder that is not empty and leaves it untouched', async () => {
    const target = path.join(world.documents, 'widgets');
    await mkdir(target);
    await writeFile(path.join(target, 'mine.txt'), 'keep me');
    const refused = await start().expect(400);
    expect(refused.body.error).toMatch(/already exists and is not empty/);
    expect(await readFile(path.join(target, 'mine.txt'), 'utf8')).toBe('keep me');
    expect(await jobs()).toEqual([]);
    expect(await projects()).toEqual([]);
  });

  it('clones into an existing empty folder', async () => {
    await mkdir(path.join(world.documents, 'widgets'));
    const started = cloneJobSchema.parse((await start().expect(202)).body);
    expect((await settled(started.id)).status).toBe('done');
  });

  it.each([
    ['a file address without the test option', 'file:///tmp/x.git', /file address/],
    ['a local path', '/tmp/x.git', /folder on this Mac/],
    ['a helper transport', 'ext::sh', /helper program/],
    ['embedded credentials', 'https://me:hunter2@github.com/a/b.git', /username or password/],
  ])('refuses %s', async (_label, url, message) => {
    client = localClient(createTestApp(t));
    const refused = await start('widgets', url).expect(400);
    expect(refused.body.error).toMatch(message);
    expect(JSON.stringify(refused.body)).not.toContain('hunter2');
  });

  it('refuses destinations outside the home folder, through symlinks and inside projects', async () => {
    const outside = path.join(world.base, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(world.home, 'shortcut'));
    expect((await start('widgets', world.sourceUrl, outside).expect(400)).body.error).toMatch(
      /inside your home folder/,
    );
    expect(
      (await start('widgets', world.sourceUrl, path.join(world.home, 'shortcut')).expect(400)).body
        .error,
    ).toMatch(/inside your home folder/);
    await symlink(outside, path.join(world.documents, 'widgets'));
    expect((await start().expect(400)).body.error).toMatch(/already exists/);

    const project = path.join(world.home, 'linked');
    await mkdir(project);
    await client.send('post', '/api/projects', { rootPath: project }).expect(201);
    expect((await start('inner', world.sourceUrl, project).expect(400)).body.error).toMatch(
      /inside the project/,
    );
    expect((await start('../escape').expect(400)).body.error).toMatch(/slash/);
    expect(await exists(path.join(outside, 'widgets'))).toBe(false);
    expect(await jobs()).toEqual([]);
  });

  it('cancels mid-clone, removes the partial folder and links nothing', async () => {
    open({ gitPath: await stallingGit(world) });
    const job = await startStalled();
    expect((await jobs())[0]).toMatchObject({ phase: 'Receiving objects', percent: 37 });
    const cancelled = cloneJobSchema.parse(
      (await client.send('post', `/api/project-clones/${job.id}/cancel`).expect(200)).body,
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', project: null, failure: null });
    expect(await exists(path.join(world.documents, 'widgets'))).toBe(false);
    expect(await projects()).toEqual([]);
    expect(await markerCount()).toBe(0);
    await client.send('delete', `/api/project-clones/${job.id}`).expect(200);
    expect(await jobs()).toEqual([]);
  });

  it('ignores a second start for a destination that is already cloning', async () => {
    open({ gitPath: await stallingGit(world) });
    const first = await startStalled();
    const second = cloneJobSchema.parse((await start().expect(200)).body);
    expect(second.id).toBe(first.id);
    expect(await jobs()).toHaveLength(1);
    expect(await markerCount()).toBe(1);
  });

  it('cleans up after a failed clone and reports a plain reason', async () => {
    const missing = `file://${path.join(world.base, 'sources', 'missing.git')}`;
    const started = cloneJobSchema.parse((await start('widgets', missing).expect(202)).body);
    const failed = await settled(started.id);
    expect(failed).toMatchObject({ status: 'failed', project: null });
    expect(failed.failure).toMatchObject({ kind: 'not_found' });
    expect(failed.failure!.summary).toMatch(/Repository not found/);
    expect(await exists(path.join(world.documents, 'widgets'))).toBe(false);
    expect(await projects()).toEqual([]);
    expect(await markerCount()).toBe(0);
  });

  it('reads a full disk as its own reason and removes the partial folder', async () => {
    open({ gitPath: await refusingGit(world, 'fatal: write error: No space left on device') });
    const started = cloneJobSchema.parse((await start().expect(202)).body);
    const failed = await settled(started.id);
    expect(failed.failure).toMatchObject({ kind: 'disk' });
    expect(await exists(path.join(world.documents, 'widgets'))).toBe(false);
  });

  it('supplies the token to git alone and leaves it nowhere on disk, in argv or in the database', async () => {
    const logs = watchConsole();
    try {
      open({ gitPath: await tokenOnlyGit(world), tokensFor: async () => [PLANTED_TOKEN] });
      const started = cloneJobSchema.parse((await start().expect(202)).body);
      const done = await settled(started.id);
      expect(done.status).toBe('done');
      const target = path.join(world.documents, 'widgets');
      const record = await tokenRecord(world);
      expect(record.askpassAnswer.trim()).toBe(PLANTED_TOKEN);
      expect(record.argv).not.toContain(PLANTED_TOKEN);
      expect(record.argv).toContain('credential.helper=');
      expect(record.askpassScript).not.toContain(PLANTED_TOKEN);
      expect(await exists(record.askpassPath)).toBe(false);
      const config = await readFile(path.join(target, '.git', 'config'), 'utf8');
      expect(config).not.toContain(PLANTED_TOKEN);
      expect(config).not.toMatch(/credential|extraheader|askpass/i);
      expect(git(target, 'remote', 'get-url', 'origin')).toBe(world.sourceUrl);
      expect(await treeText(target)).not.toContain(PLANTED_TOKEN);
      expect(await treeText(world.home)).not.toContain(PLANTED_TOKEN);
      expect(await everyRow(t)).not.toContain(PLANTED_TOKEN);
      expect(JSON.stringify(await jobs())).not.toContain(PLANTED_TOKEN);
      expect(logs.text()).not.toContain(PLANTED_TOKEN);
    } finally {
      logs.restore();
    }
  });

  it('redacts secrets in the git error it shows', async () => {
    const message = `fatal: unable to access 'https://x-access-token:${PLANTED_TOKEN}@github.com/acme/private.git/': The requested URL returned error: 403\nremote: token ${PLANTED_TOKEN} and ghp_abcdefghijklmnopqrstuvwxyz0123456789 refused`;
    open({ gitPath: await refusingGit(world, message), tokensFor: async () => [PLANTED_TOKEN] });
    const started = cloneJobSchema.parse((await start().expect(202)).body);
    const failed = await settled(started.id);
    expect(failed.failure).toMatchObject({ kind: 'auth' });
    expect(failed.failure!.detail).toContain('[redacted:');
    expect(JSON.stringify(failed)).not.toContain(PLANTED_TOKEN);
    expect(JSON.stringify(failed)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(await exists(path.join(world.documents, 'widgets'))).toBe(false);
  });
});

describe('a clone the app quit in the middle of', () => {
  async function leftover(name: string) {
    const target = path.join(world.documents, name);
    await mkdir(path.join(target, '.git'), { recursive: true });
    await writeFile(path.join(target, '.git', 'partial'), 'partial');
    const stats = await lstat(target, { bigint: true });
    return { target, dev: stats.dev.toString(), ino: stats.ino.toString() };
  }

  async function mark(target: string, dev: string, ino: string, pid: number | null = null) {
    await t.db.query(
      `INSERT INTO project_clones (id, workspace_id, source, destination, dir_dev, dir_ino, pid)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
      [t.workspaceId, world.sourceUrl, target, dev, ino, pid],
    );
  }

  async function restart() {
    const clones = cloneJobsFor({
      db: t.db,
      workspaceId: t.workspaceId,
      secrets: memorySecretStore(),
      runCommand: async () => ({ code: 1, stdout: '', stderr: '' }),
      loginShell: null,
      endpoints: {
        anthropicBaseUrl: '',
        openaiBaseUrl: '',
        typesafeBaseUrl: '',
        zaiBaseUrl: '',
        fetch,
      },
      cloneTest: { root: world.home },
    });
    await clones.recover();
    return clones.list();
  }

  it('is reported as failed and its partial folder is removed', async () => {
    const { target, dev, ino } = await leftover('widgets');
    await mark(target, dev, ino);
    const [job, ...rest] = await restart();
    expect(rest).toEqual([]);
    expect(job).toMatchObject({ status: 'failed', destination: target, project: null });
    expect(job!.failure).toMatchObject({ kind: 'interrupted' });
    expect(job!.failure!.detail).toMatch(/removed/);
    expect(await exists(target)).toBe(false);
    expect(await markerCount()).toBe(0);
    expect(await projects()).toEqual([]);
  });

  it('leaves a folder that is no longer the one Spark created', async () => {
    const { target, dev } = await leftover('widgets');
    await mark(target, dev, '1');
    const [job] = await restart();
    expect(job!.failure!.detail).toMatch(/left the folder alone/);
    expect(await exists(path.join(target, '.git', 'partial'))).toBe(true);
    expect(await markerCount()).toBe(0);
  });

  it('stops a git process that outlived the app', async () => {
    const { target, dev, ino } = await leftover('widgets');
    const orphan = spawn(await stallingGit(world), ['clone', '--', world.sourceUrl, target], {
      detached: true,
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => orphan.once('exit', resolve));
    await mark(target, dev, ino, orphan.pid!);
    await restart();
    await exited;
    expect(orphan.signalCode).toBe('SIGKILL');
    expect(await exists(target)).toBe(false);
  });

  it('never signals an unrelated process that reused the pid', async () => {
    const { target, dev, ino } = await leftover('widgets');
    const bystander = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    await mark(target, dev, ino, bystander.pid!);
    await restart();
    expect(bystander.exitCode).toBeNull();
    expect(bystander.signalCode).toBeNull();
    bystander.kill('SIGKILL');
  });
});
