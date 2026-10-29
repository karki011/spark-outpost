import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertChatWorktree, sweepableChatWorktrees } from '../src/persistence/chat-worktrees.ts';
import { sweepChatWorktrees } from '../src/projects/chat-worktree-sweep.ts';
import { addChatWorktree } from '../src/projects/chat-worktrees.ts';
import { worktreePath } from '../src/projects/worktrees.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { gitRepo, removeRepo } from './turn-support.ts';

let t: TestDb;
let root: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
});

afterEach(async () => {
  await t.cleanup();
  await removeRepo(root);
});

async function sweep(): Promise<void> {
  await sweepChatWorktrees(t.db, (work) => work(), new AbortController().signal);
}

async function archivedChatWithDirtyWorktree() {
  const { conversationId, projectId } = await linkedConversation(t, root);
  const id = randomUUID();
  const path = worktreePath(root, id);
  const branch = `spark/sweep-${id.slice(0, 8)}`;
  const base = git(root, 'rev-parse', 'HEAD');
  await addChatWorktree(root, path, { kind: 'new', branch, from: base });
  await insertChatWorktree(t.db, {
    id,
    conversationId,
    projectId,
    repoRoot: root,
    path,
    branch,
    baseBranch: null,
    baseCommit: base,
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
  await writeFile(join(path, 'notes.txt'), 'unsaved work\n');
  await setArchived(conversationId, true);
  return { conversationId, id, path, branch };
}

async function setArchived(conversationId: string, archived: boolean): Promise<void> {
  await t.db.query(
    `UPDATE conversations SET archived_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END
     WHERE id = $1`,
    [conversationId, archived],
  );
}

async function sweepableIds(): Promise<string[]> {
  return (await sweepableChatWorktrees(t.db)).map((record) => record.id);
}

describe('sweeping the worktree of an archived chat with uncommitted work', () => {
  it('keeps the work and stops checking it on every sweep', async () => {
    const chat = await archivedChatWithDirtyWorktree();
    expect(await sweepableIds()).toEqual([chat.id]);

    await sweep();

    expect(existsSync(chat.path)).toBe(true);
    expect(git(chat.path, 'status', '--porcelain')).toContain('notes.txt');
    expect(await sweepableIds()).toEqual([]);
  });

  it('checks it again once the chat is restored, or archived again', async () => {
    const chat = await archivedChatWithDirtyWorktree();
    await sweep();

    await setArchived(chat.conversationId, false);
    expect(await sweepableIds()).toEqual([chat.id]);

    await setArchived(chat.conversationId, true);
    expect(await sweepableIds()).toEqual([chat.id]);
    await sweep();
    expect(existsSync(chat.path)).toBe(true);
    expect(await sweepableIds()).toEqual([]);
  });

  it('checks it again a day later and removes it once the work is gone', async () => {
    const chat = await archivedChatWithDirtyWorktree();
    await sweep();
    git(chat.path, 'checkout', '--', 'notes.txt');
    await sweep();
    expect(existsSync(chat.path)).toBe(true);

    await t.db.query(
      `UPDATE chat_worktrees SET kept_dirty_at = kept_dirty_at - interval '25 hours' WHERE id = $1`,
      [chat.id],
    );
    await t.db.query(
      `UPDATE conversations SET archived_at = archived_at - interval '25 hours' WHERE id = $1`,
      [chat.conversationId],
    );
    await sweep();

    expect(existsSync(chat.path)).toBe(false);
  });

  it('saves the work on its branch and removes the worktree once the chat is deleted', async () => {
    const chat = await archivedChatWithDirtyWorktree();
    await sweep();

    await t.db.query('DELETE FROM conversations WHERE id = $1', [chat.conversationId]);
    await sweep();

    expect(existsSync(chat.path)).toBe(false);
    expect(git(root, 'show', `${chat.branch}:notes.txt`)).toBe('unsaved work');
  });
});
