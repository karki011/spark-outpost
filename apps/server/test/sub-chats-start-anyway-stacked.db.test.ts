import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubChatsResponse } from '@spark-outpost/contracts';
import { STACKED_WORK_NOT_COMMITTED } from '../src/api/sub-chat-routes.ts';
import { getSubChat } from '../src/persistence/sub-chats.ts';
import { runCommand } from '../src/setup/command.ts';
import { createTestApp, localClient } from './app-support.ts';
import { turnsOf } from './chat-ask-fixtures.ts';
import { git, type TestRepo } from './ship-support.ts';
import {
  KEPT_FILE,
  stackAtAutomatic,
  uncommitted,
  type Stack,
} from './stacked-sub-chat-fixtures.ts';
import { asksOf, startTask } from './sub-chat-report-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let base: string;
let app: ReturnType<typeof createTestApp>;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-start-anyway-stacked-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  await connectAgents(t);
  app = createTestApp(t, { runCommand });
});

afterEach(async () => {
  await t.cleanup();
});

function startAnyway({ parent, web }: Stack) {
  return localClient(app).send('post', `/api/conversations/${parent}/sub-chats/${web}/start`);
}

async function isStarted(chat: string): Promise<boolean> {
  return (await getSubChat(t.db, chat))?.startedAt != null;
}

async function refuseCommits(repo: TestRepo): Promise<string> {
  const hook = path.join(repo.root, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  return hook;
}

describe(
  'Start anyway on a sub-chat stacked on one with kept changes',
  { timeout: 120_000 },
  () => {
    it('commits the kept changes on the other sub-chat’s branch, unpushed, before it starts', async () => {
      const stack = await stackAtAutomatic(t, base, 'manual');
      expect(uncommitted(stack.base)).toContain(KEPT_FILE);

      const response = await startAnyway(stack).expect(200);

      const rows = (response.body as SubChatsResponse).subChats;
      expect(rows.find((row) => row.id === stack.web)?.status).not.toBe('held');
      expect(await isStarted(stack.web)).toBe(true);
      expect(uncommitted(stack.base)).toBe('');
      expect(git(stack.repo.root, 'show', `${stack.base.branch}:${KEPT_FILE}`)).toContain('step 1');
      expect(git(stack.repo.bare, 'branch', '--list', stack.base.branch)).toBe('');
      expect(await turnsOf(t, stack.web)).toHaveLength(1);
    });

    it('answers 409 and leaves it Held while the commit cannot be made, then starts', async () => {
      const stack = await stackAtAutomatic(t, base, 'refused');
      const hook = await refuseCommits(stack.repo);

      const refused = await startAnyway(stack).expect(409);

      expect(refused.body.error).toBe(STACKED_WORK_NOT_COMMITTED);
      expect(await isStarted(stack.web)).toBe(false);
      expect(await asksOf(t, stack.web, 'task')).toEqual([]);
      expect(await turnsOf(t, stack.web)).toEqual([]);
      expect(uncommitted(stack.base)).toContain(KEPT_FILE);

      await rm(hook);
      await startAnyway(stack).expect(200);
      expect(await isStarted(stack.web)).toBe(true);
      expect(uncommitted(stack.base)).toBe('');
    });

    it('changes and commits nothing for one that already started', async () => {
      const stack = await stackAtAutomatic(t, base, 'already');
      await startTask(t, stack.web);
      await refuseCommits(stack.repo);
      const head = git(stack.base.path, 'rev-parse', 'HEAD');

      await startAnyway(stack).expect(200);

      expect(uncommitted(stack.base)).toContain(KEPT_FILE);
      expect(git(stack.base.path, 'rev-parse', 'HEAD')).toBe(head);
      expect(await asksOf(t, stack.web, 'task')).toHaveLength(1);
      expect(await turnsOf(t, stack.web)).toHaveLength(1);
    });
  },
);
