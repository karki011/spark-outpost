import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRailFlags } from '../src/persistence/rail-flags.ts';
import { startRailFlags } from '../src/workflow/rail-flags.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, removeRepo, sendMessage } from './turn-support.ts';

let t: TestDb;
let repo: string;
let worktree: string;
let conversationId: string;
let runId: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

const audit = { message: () => undefined, stderr: () => undefined };

beforeEach(async () => {
  t = await createTestDb();
  repo = await gitRepo();
  worktree = path.join(await realpath(await mkdtemp(path.join(tmpdir(), 'spark-flag-wt-'))), 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'spark/notes-1a2b3c4d', worktree);
  conversationId = (await linkedConversation(t, worktree)).conversationId;
  runId = await sendMessage(t, conversationId, 'Tidy the notes', { permission: 'do' });
});

afterEach(async () => {
  await t.cleanup();
  await rm(path.dirname(worktree), { recursive: true, force: true });
  await removeRepo(repo);
});

async function flagsAfter(change: () => Promise<void>) {
  const flags = await startRailFlags({ db: t.db, runId, projectRoots: [worktree], audit });
  await change();
  await flags.finish();
  return (await listRailFlags(t.db, conversationId)).map(({ rail, paths }) => ({ rail, paths }));
}

describe('what Spark notices after a run in a chat that works in a worktree', () => {
  it("flags a change to the worktree's own config.worktree", async () => {
    const own = git(worktree, 'rev-parse', '--path-format=absolute', '--git-dir');

    const flags = await flagsAfter(() =>
      writeFile(path.join(own, 'config.worktree'), '[core]\n\tfsmonitor = /tmp/run-me\n'),
    );

    expect(flags).toEqual([{ rail: 'git_control', paths: ['.git/config.worktree'] }]);
  });

  it('still flags a hook written in the real git folder', async () => {
    const common = git(worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir');

    const flags = await flagsAfter(() =>
      writeFile(path.join(common, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n'),
    );

    expect(flags).toEqual([{ rail: 'git_control', paths: ['.git/hooks/pre-commit'] }]);
  });

  it('flags nothing when no control file changed', async () => {
    expect(
      await flagsAfter(() => writeFile(path.join(worktree, 'notes.txt'), 'changed\n')),
    ).toEqual([]);
  });
});
