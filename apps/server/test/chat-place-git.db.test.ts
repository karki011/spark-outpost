import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { doRun } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let folder: string;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  folder = await mkdtemp(join(tmpdir(), 'spark-no-git-'));
});

afterEach(async () => {
  await t.cleanup();
  await rm(folder, { recursive: true, force: true });
});

async function placeWith(installed: boolean) {
  const { runId } = await doRun(t, folder);
  const input = await loadRunInput(t.db, runId);
  return placeChat(
    { db: t.db, branchPrefix: 'spark', gitInstalled: async () => installed },
    input,
    true,
  );
}

describe('Do chats placed in a new worktree', () => {
  it('report fetching, creating the worktree and copying dependencies as each begins', async () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    const remote = join(folder, 'remote.git');
    const repo = await realpath(await mkdtemp(join(folder, 'repo-')));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    git(repo, 'init', '-q', '-b', 'main');
    await writeFile(join(repo, 'package.json'), '{"name":"app"}');
    await writeFile(join(repo, '.gitignore'), 'node_modules\n');
    await mkdir(join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'base');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    const { runId } = await doRun(t, repo);
    const phases: string[] = [];
    const placed = await placeChat(
      { db: t.db, branchPrefix: 'spark', onPhase: (phase) => phases.push(phase) },
      await loadRunInput(t.db, runId),
      true,
    );
    expect(placed.input.chatWorktree).toBe(true);
    expect(phases).toEqual(['fetch', 'worktree', 'copy']);
    const again: string[] = [];
    await placeChat(
      { db: t.db, branchPrefix: 'spark', onPhase: (phase) => again.push(phase) },
      await loadRunInput(t.db, runId),
      true,
    );
    expect(again).toEqual([]);
  });
});

describe('Do chats in a folder without git', () => {
  it('explain that a missing git means no worktree and how to install it', async () => {
    const placed = await placeWith(false);
    expect(placed.input.chatWorktree).toBe(false);
    expect(placed.note).toContain('Git isn’t installed');
    expect(placed.note).toContain('xcode-select --install');
  });

  it('stay quiet when git is installed and the folder just is not a repository', async () => {
    const placed = await placeWith(true);
    expect(placed.note).toBeNull();
  });
});
