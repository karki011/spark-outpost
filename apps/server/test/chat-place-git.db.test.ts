import { mkdtemp, rm } from 'node:fs/promises';
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
  return placeChat({ db: t.db, branchPrefix: 'spark', gitInstalled: async () => installed }, input);
}

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
