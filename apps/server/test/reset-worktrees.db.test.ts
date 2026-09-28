import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertWorktree } from '../src/persistence/worktrees.ts';
import { addWorktree, branchName, worktreePath } from '../src/projects/worktrees.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { gitRepo, removeRepo } from './orchestration-support.ts';
import { postReset, seedRun } from './reset-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let remote: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  });

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  remote = await realpath(await mkdtemp(join(tmpdir(), 'spark-reset-remote-')));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git('remote', 'add', 'origin', remote);
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
  await removeRepo(remote);
});

async function appCopy(name: string): Promise<{ target: string; branch: string }> {
  const orchestrationRunId = await seedRun(t);
  const runId = await seedRun(t);
  const branch = branchName(runId, name);
  const target = worktreePath(root, runId);
  const base = git('rev-parse', 'HEAD').trim();
  await insertWorktree(t.db, {
    runId,
    orchestrationRunId,
    repoRoot: root,
    path: target,
    branch,
    baseCommit: base,
  });
  await addWorktree(root, target, branch, base);
  return { target, branch };
}

const branches = () =>
  git('branch', '--format=%(refname:short)')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

describe('resetting app-owned worktrees', () => {
  it('removes the copies and local branches Spark made and leaves the user’s work alone', async () => {
    const local = await appCopy('builder');
    const pushed = await appCopy('shipped');
    git('push', '-q', '-u', 'origin', pushed.branch);
    const userTree = join(root, '..', `${root.split('/').pop()}-mine`);
    git('worktree', 'add', '-q', '-b', 'feature/mine', userTree);

    const response = await postReset(t, memorySecretStore(), { keepApiKeys: false });

    expect(response.body).toMatchObject({ worktreesRemoved: 2, problems: [] });
    expect(existsSync(local.target)).toBe(false);
    expect(existsSync(pushed.target)).toBe(false);
    expect(existsSync(join(root, 'notes.txt'))).toBe(true);
    expect(existsSync(userTree)).toBe(true);
    expect(branches()).not.toContain(local.branch);
    expect(branches()).toEqual(expect.arrayContaining([pushed.branch, 'feature/mine']));
    expect(git('worktree', 'list')).not.toContain('.spark');
    await removeRepo(userTree);
  });

  it('only touches copies Spark still tracks as live', async () => {
    const done = await appCopy('done');
    await t.db.query('UPDATE run_worktrees SET removed_at = now()');

    const response = await postReset(t, memorySecretStore(), { keepApiKeys: false });

    expect(response.body.worktreesRemoved).toBe(0);
    expect(existsSync(done.target)).toBe(true);
    expect(branches()).toContain(done.branch);
  });
});
