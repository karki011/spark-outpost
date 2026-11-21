import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { primaryChatWorktree, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { getSubChat, insertSubChat } from '../src/persistence/sub-chats.ts';
import { createProject } from '../src/projects/projects.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { deliveryPass } from '../src/sub-chats/delivery.ts';
import { chatTarget } from '../src/workflow/queue-drain.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { turnsOf } from './chat-ask-fixtures.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { projectChat } from './stack-support.ts';
import { STARTED_WITH } from './sub-chat-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, openChat, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';

let t: TestDb;
let base: string;
let worker: Worker | null = null;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-sub-chat-stacked-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  await connectAgents(t);
  worker = startTurnWorker(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
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

async function asSubChat(parent: string, chat: string, stackedOn: string | null): Promise<void> {
  await withTransaction(t.db, (client) =>
    insertSubChat(client, {
      conversationId: chat,
      parentConversationId: parent,
      task: 'Build the page.',
      stackedOn,
      startsAfter: [],
      startedWith: STARTED_WITH,
      approvalId: null,
    }),
  );
}

interface Stack {
  repo: TestRepo;
  web: string;
  base: ChatWorktree;
}

async function stackAtAutomatic(name: string, childRoot?: string): Promise<Stack> {
  const repo = await repoWithRemote(base, name);
  const parent = await openChat(t, { root: repo.root });
  const api = await openChat(t, { root: repo.root, level: 'hands-off' });
  await asSubChat(parent, api, null);
  await t.db.query('UPDATE sub_chats SET started_at = now() WHERE conversation_id = $1', [api]);
  const runId = await sendMessage(t, api, BUILD, { permission: 'do' });
  await driveToEnd(t, api, runId, undefined, 90_000);
  await worker?.stop();
  worker = null;
  const tree = (await primaryChatWorktree(t.db, api))!;
  const childProject = childRoot
    ? (await createProject(t.db, t.workspaceId, childRoot)).project.id
    : tree.projectId;
  const web = await projectChat(t, childProject);
  await asSubChat(parent, web, api);
  return { repo, web, base: tree };
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
    const { repo, web, base: stackedOn } = await stackAtAutomatic('kept');
    expect(git(stackedOn.path, 'status', '--porcelain')).toContain('notes.txt');
    const main = git(repo.root, 'rev-parse', 'main');

    await pass();

    expect(await isStarted(web)).toBe(true);
    expect(git(stackedOn.path, 'status', '--porcelain')).toBe('');
    expect(git(repo.root, 'show', `${stackedOn.branch}:notes.txt`)).toContain('step 1');
    const child = await taskWorktree(web);
    expect(child.baseBranch).toBe(stackedOn.branch);
    expect(await readFile(path.join(child.path, 'notes.txt'), 'utf8')).toContain('step 1');
    expect(git(repo.root, 'rev-parse', 'main')).toBe(main);
    expect(git(repo.bare, 'branch', '--list', stackedOn.branch)).toBe('');
  });

  it('stays Held while a repository hook refuses the commit, then starts', async () => {
    const { repo, web, base: stackedOn } = await stackAtAutomatic('hooked');
    const hook = path.join(repo.root, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);

    await pass();

    expect(await isStarted(web)).toBe(false);
    expect(git(stackedOn.path, 'status', '--porcelain')).toContain('notes.txt');
    await rm(hook);
    await pass();
    expect(await isStarted(web)).toBe(true);
    expect(git(stackedOn.path, 'status', '--porcelain')).toBe('');
  });

  it('starts without a commit when it works in another project', async () => {
    const other = await repoWithRemote(base, 'elsewhere');
    const { web, base: stackedOn } = await stackAtAutomatic('apart', other.root);

    await pass();

    expect(await isStarted(web)).toBe(true);
    expect(git(stackedOn.path, 'status', '--porcelain')).toContain('notes.txt');
  });
});
