import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { primaryChatWorktree, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { getSubChat } from '../src/persistence/sub-chats.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { chatTarget } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { turnsOf } from './chat-ask-fixtures.ts';
import { git, repoWithRemote } from './ship-support.ts';
import { KEPT_FILE, stackAtAutomatic, uncommitted } from './stacked-sub-chat-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let base: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-sub-chat-stacked-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  await connectAgents(t);
});

afterEach(async () => {
  await t.cleanup();
});

function pass(): Promise<void> {
  return deliveryPass(t.db, chatTarget(t.db), {
    ship: {
      db: t.db,
      workspaceId: t.workspaceId,
      secrets: memorySecretStore(),
      runCommand,
      fetch,
      locateGh: async () => null,
      branchPrefix: 'spark',
    },
  });
}

async function isStarted(chat: string): Promise<boolean> {
  return (await getSubChat(t.db, chat))?.startedAt != null;
}

async function taskWorktree(web: string): Promise<ChatWorktree> {
  const [turn] = await turnsOf(t, web);
  const input = await loadRunInput(t.db, turn!.id);
  await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
  return (await primaryChatWorktree(t.db, web))!;
}

describe('a sub-chat stacked on one at Automatic', { timeout: 120_000 }, () => {
  it('starts on the kept change, committed locally on the other sub-chat’s own branch', async () => {
    const { repo, web, base: stackedOn } = await stackAtAutomatic(t, base, 'kept');
    expect(uncommitted(stackedOn)).toContain(KEPT_FILE);
    const main = git(repo.root, 'rev-parse', 'main');

    await pass();

    expect(await isStarted(web)).toBe(true);
    expect(uncommitted(stackedOn)).toBe('');
    expect(git(repo.root, 'show', `${stackedOn.branch}:notes.txt`)).toContain('step 1');
    const child = await taskWorktree(web);
    expect(child.baseBranch).toBe(stackedOn.branch);
    expect(await readFile(path.join(child.path, 'notes.txt'), 'utf8')).toContain('step 1');
    expect(git(repo.root, 'rev-parse', 'main')).toBe(main);
    expect(git(repo.bare, 'branch', '--list', stackedOn.branch)).toBe('');
  });

  it('stays Held while a repository hook refuses the commit, then starts', async () => {
    const { repo, web, base: stackedOn } = await stackAtAutomatic(t, base, 'hooked');
    const hook = path.join(repo.root, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);

    await pass();

    expect(await isStarted(web)).toBe(false);
    expect(uncommitted(stackedOn)).toContain(KEPT_FILE);
    await rm(hook);
    await pass();
    expect(await isStarted(web)).toBe(true);
    expect(uncommitted(stackedOn)).toBe('');
  });

  it('starts without a commit when it works in another project', async () => {
    const other = await repoWithRemote(base, 'elsewhere');
    const { web, base: stackedOn } = await stackAtAutomatic(t, base, 'apart', other.root);

    await pass();

    expect(await isStarted(web)).toBe(true);
    expect(uncommitted(stackedOn)).toContain(KEPT_FILE);
  });
});
