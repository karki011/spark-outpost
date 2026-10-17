import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listFileReverts } from '../src/persistence/file-reverts.ts';
import { revertFile } from '../src/projects/file-revert.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  changeSet,
  check,
  gitIn,
  listedPaths,
  revert,
  runFacts,
  runTurn,
  scriptedAgent,
  type Ops,
} from './file-revert-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { auditOf, gitRepo, openChat, removeRepo } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let repo: string;
let worker: Worker;
let queue: Ops[];

const exists = (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  t = await createTestDb();
  repo = await gitRepo();
  await writeFile(path.join(repo, 'old.txt'), 'old name\nsecond line\n');
  await writeFile(path.join(repo, 'gone.txt'), 'keep me\n');
  await writeFile(path.join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  gitIn(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  gitIn(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'more');
  queue = [];
  await connectAgents(t);
  const agent = scriptedAgent(queue);
  worker = startTurnWorker(t, { providers: new Map([[agent.name, agent]]) });
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
  await removeRepo(repo);
});

async function firstTurn(ops: Ops) {
  const conversationId = await openChat(t, { root: repo });
  queue.push(ops);
  const runId = await runTurn(t, conversationId);
  return { conversationId, runId, ...(await runFacts(t, runId)) };
}

describe('reverting one file of a kept run', { timeout: 60_000 }, () => {
  it('restores only that file, records it and writes an audit entry', async () => {
    const { runId, taskId, root } = await firstTurn({
      write: { 'notes.txt': 'agent notes\n', 'old.txt': 'old name\nedited\n', 'new.txt': 'new\n' },
    });
    expect(await listedPaths(t, taskId)).toEqual(['new.txt', 'notes.txt', 'old.txt']);
    expect(await check(t, taskId, runId, 'notes.txt')).toMatchObject({
      revertible: true,
      reason: null,
      committed: false,
      pushed: false,
      protectedKind: null,
    });

    const done = await revert(t, taskId, runId, 'notes.txt');

    expect(done.restored).toEqual([{ path: 'notes.txt', change: 'modified' }]);
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('start\n');
    expect(await readFile(path.join(root, 'old.txt'), 'utf8')).toBe('old name\nedited\n');
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('new\n');
    expect(await listedPaths(t, taskId)).toEqual(['new.txt', 'old.txt']);
    const run = (await changeSet(t, taskId)).runs.find((entry) => entry.runId === runId);
    expect(run?.reverted).toEqual([{ path: 'notes.txt', revertedAt: done.revertedAt }]);
    const audit = (await auditOf(t, runId)).filter((entry) => entry.kind === 'revert');
    expect(audit).toMatchObject([
      {
        direction: 'harness',
        method: 'spark/revert_file',
        payload: { path: 'notes.txt', change: 'modified' },
      },
    ]);
  });

  it('deletes a file the run created and restores one it deleted', async () => {
    const { runId, taskId, root } = await firstTurn({
      write: { 'made/new.txt': 'new\n' },
      remove: ['gone.txt'],
    });

    await revert(t, taskId, runId, 'made/new.txt');
    await revert(t, taskId, runId, 'gone.txt');

    expect(await exists(path.join(root, 'made/new.txt'))).toBe(false);
    expect(await readFile(path.join(root, 'gone.txt'), 'utf8')).toBe('keep me\n');
    expect(await listedPaths(t, taskId)).toEqual([]);
    expect(gitIn(root, 'status', '--porcelain')).toBe('');
  });

  it('undoes a rename as one change and restores a binary file byte for byte', async () => {
    const { runId, taskId, root } = await firstTurn({
      move: [['old.txt', 'renamed.txt']],
      write: { 'logo.bin': Buffer.from([0, 9, 9, 9, 0, 1]) },
    });
    const entries = (await changeSet(t, taskId)).entries.map((entry) => entry.listed.file);
    expect(entries).toMatchObject([
      { path: 'logo.bin', shown: 'binary' },
      { path: 'renamed.txt', oldPath: 'old.txt' },
    ]);

    const moved = await revert(t, taskId, runId, 'renamed.txt');
    await revert(t, taskId, runId, 'logo.bin');

    expect(moved.restored).toEqual([
      { path: 'old.txt', change: 'deleted' },
      { path: 'renamed.txt', change: 'added' },
    ]);
    expect(await readFile(path.join(root, 'old.txt'), 'utf8')).toBe('old name\nsecond line\n');
    expect(await exists(path.join(root, 'renamed.txt'))).toBe(false);
    expect([...(await readFile(path.join(root, 'logo.bin')))]).toEqual([0, 1, 2, 3, 0, 255]);
  });

  it('refuses a file you changed after the run, and a second revert of the same file', async () => {
    const { runId, taskId, root } = await firstTurn({
      write: { 'notes.txt': 'agent notes\n', 'new.txt': 'new\n' },
    });
    await writeFile(path.join(root, 'notes.txt'), 'my own edit\n');

    expect(await check(t, taskId, runId, 'notes.txt')).toMatchObject({
      revertible: false,
      reason: expect.stringContaining('changed after this run'),
    });
    await expect(revert(t, taskId, runId, 'notes.txt')).rejects.toThrow(/changed after this run/);
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('my own edit\n');

    const stale = await changeSet(t, taskId);
    await revert(t, taskId, runId, 'new.txt');
    await expect(revertFile(t.db, t.workspaceId, stale, runId, 'new.txt')).rejects.toThrow(
      /already reverted/,
    );
    expect(await listFileReverts(t.db, [runId])).toHaveLength(1);
  });

  it('refuses an earlier run’s file a later run changed, and reverts an untouched one cleanly', async () => {
    const {
      conversationId,
      runId: first,
      taskId,
      root,
    } = await firstTurn({
      write: { 'notes.txt': 'first\n', 'old.txt': 'first edit\n' },
    });
    queue.push({ write: { 'notes.txt': 'second\n' } });
    const second = await runTurn(t, conversationId);

    expect(await check(t, taskId, first, 'notes.txt')).toMatchObject({
      revertible: false,
      reason: expect.stringContaining('changed after this run'),
    });

    await revert(t, taskId, first, 'old.txt');

    expect(await readFile(path.join(root, 'old.txt'), 'utf8')).toBe('old name\nsecond line\n');
    const entries = (await changeSet(t, taskId)).entries.map((entry) => [
      entry.runId,
      entry.listed.file.path,
    ]);
    expect(entries).toEqual([
      [first, 'notes.txt'],
      [second, 'notes.txt'],
    ]);
  });

  it('reverts committed work in the working copy only and says it was committed', async () => {
    const { runId, taskId, root } = await firstTurn({ write: { 'notes.txt': 'agent notes\n' } });
    gitIn(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'agent work');
    const head = gitIn(root, 'rev-parse', 'HEAD');

    expect(await check(t, taskId, runId, 'notes.txt')).toMatchObject({
      revertible: true,
      committed: true,
      pushed: false,
    });
    await revert(t, taskId, runId, 'notes.txt');

    expect(gitIn(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('start\n');
    expect(gitIn(root, 'status', '--porcelain')).toBe(' M notes.txt\n');
  });

  it('never rewrites pushed work: the commit and the remote branch stay', async () => {
    const remote = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-revert-remote-')));
    try {
      const { runId, taskId, root } = await firstTurn({
        write: { 'notes.txt': 'agent notes\n', 'new.txt': 'new\n' },
      });
      gitIn(remote, 'init', '-q', '--bare');
      gitIn(root, 'checkout', '-q', '-b', 'spark/pushed-work');
      gitIn(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
      gitIn(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'agent work');
      const branch = gitIn(root, 'branch', '--show-current').trim();
      gitIn(root, 'remote', 'add', 'origin', remote);
      gitIn(root, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
      gitIn(root, 'fetch', '-q', 'origin');
      const head = gitIn(root, 'rev-parse', 'HEAD');
      const pushed = gitIn(root, 'rev-parse', `refs/remotes/origin/${branch}`);

      expect(await check(t, taskId, runId, 'notes.txt')).toMatchObject({
        revertible: true,
        committed: true,
        pushed: true,
      });
      await revert(t, taskId, runId, 'notes.txt');

      expect(gitIn(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(gitIn(root, 'rev-parse', `refs/remotes/origin/${branch}`)).toBe(pushed);
      expect(gitIn(remote, 'rev-parse', `refs/heads/${branch}`)).toBe(pushed);
      expect(gitIn(root, 'status', '--porcelain')).toBe(' M notes.txt\n');
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  });

  it('waits while the chat is working', async () => {
    const { runId, taskId } = await firstTurn({ write: { 'notes.txt': 'agent notes\n' } });
    await t.db.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [runId]);

    expect(await check(t, taskId, runId, 'notes.txt')).toMatchObject({
      revertible: false,
      reason: expect.stringContaining('still working'),
    });
  });

  it('names an agent instruction file in the check', async () => {
    const { runId, taskId } = await firstTurn({ write: { 'AGENTS.md': '# rules\n' } });

    expect(await check(t, taskId, runId, 'AGENTS.md')).toMatchObject({
      revertible: true,
      protectedKind: 'instructions',
    });
  });
});

describe('reverting one file in a folder that is not a git repository', { timeout: 60_000 }, () => {
  it('restores that file from the run’s backup and leaves the others', async () => {
    const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-revert-plain-')));
    await writeFile(path.join(folder, 'notes.txt'), 'draft\n');
    try {
      const conversationId = await openChat(t, { root: folder });
      queue.push({ write: { 'notes.txt': 'final\n', 'new.txt': 'added\n' } });
      const runId = await runTurn(t, conversationId);
      const { taskId } = await runFacts(t, runId);

      await revert(t, taskId, runId, 'new.txt');

      expect(await exists(path.join(folder, 'new.txt'))).toBe(false);
      expect(await readFile(path.join(folder, 'notes.txt'), 'utf8')).toBe('final\n');
      expect(await listedPaths(t, taskId)).toEqual(['notes.txt']);
      await expect(revert(t, taskId, runId, 'new.txt')).rejects.toThrow(/no changes in this run/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
