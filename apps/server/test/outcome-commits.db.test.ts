import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureKept, refreshOutcome } from '../src/outcomes/record.ts';
import { takeGitSnapshot } from '../src/projects/snapshot.ts';
import { seedAccept, seedConversation, seedTurn } from './outcome-seed.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });
const repoState = () => ({
  refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
  status: git('status', '--porcelain'),
  head: git('rev-parse', 'HEAD'),
});

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-outcome-commits-')));
  await writeFile(join(root, 'notes.txt'), 'start\n');
  await writeFile(join(root, 'old.txt'), 'old\n');
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

async function link(): Promise<void> {
  await t.db.query(
    'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
    [randomUUID(), t.workspaceId, 'repo', root],
  );
}

async function keptTurn(): Promise<string> {
  const conversationId = await seedConversation(t.db, t.workspaceId);
  const runId = randomUUID();
  const ref = await takeGitSnapshot(root, runId);
  const seeded = await seedTurn(t.db, conversationId, { snapshot: { ref, root } });
  await writeFile(join(root, 'notes.txt'), 'start\nkept line\n');
  await writeFile(join(root, 'added.txt'), 'new file\n');
  git('rm', '-q', 'old.txt');
  await seedAccept(t.db, seeded, 'keep');
  await captureKept(t.db, t.workspaceId, seeded);
  return seeded;
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const check = (runId: string, minutes: number) =>
  refreshOutcome(t.db, t.workspaceId, runId, {
    now: later(minutes),
    random: () => 0.99,
    checkCommits: true,
  });
const committed = async (runId: string, minutes: number) =>
  (await check(runId, minutes))!.signals.find((signal) => signal.kind === 'committed');

describe('commit detection', () => {
  it('finds the kept content in a later commit on the branch, read-only', async () => {
    await link();
    const runId = await keptTurn();
    const before = repoState();
    expect(await committed(runId, 0)).toBeUndefined();
    expect(repoState()).toEqual(before);

    git('add', 'notes.txt');
    git('commit', '-qm', 'partial');
    expect(await committed(runId, 11)).toBeUndefined();

    git('add', '-A');
    git('commit', '-qm', 'the rest');
    const sha = git('rev-parse', 'HEAD').trim();
    const settledState = repoState();
    expect(await committed(runId, 5)).toBeUndefined();
    const found = await committed(runId, 22);
    expect(found).toMatchObject({ source: 'git', polarity: 1 });
    expect(found!.detail).toEqual({ commit: sha, branch: 'main' });
    expect(repoState()).toEqual(settledState);
  });

  it('checks only repos the user linked', async () => {
    const runId = await keptTurn();
    git('add', '-A');
    git('commit', '-qm', 'as kept');
    expect(await committed(runId, 11)).toBeUndefined();
    await link();
    expect(await committed(runId, 22)).toMatchObject({ kind: 'committed' });
  });

  it('skips a kept result that was later reverted', async () => {
    await link();
    const runId = await keptTurn();
    await t.db.query('UPDATE runs SET reverted_at = now() WHERE id = $1', [runId]);
    git('add', '-A');
    git('commit', '-qm', 'as kept');
    expect(await committed(runId, 11)).toBeUndefined();
  });
});
