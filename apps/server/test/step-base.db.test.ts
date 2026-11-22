import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { runChanges } from '../src/projects/run-changes.ts';
import { takeSnapshot } from '../src/workflow/do-run.ts';
import { chatBaseUpdate, stepBaseUpdate } from '../src/workflow/step-base.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const BRANCH = 'spark/tidy-1a2b3c4d';

let t: TestDb;
let base: string;
let root: string;
let conversationId: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);

function commit(file: string, text: string) {
  writeFileSync(path.join(root, file), text);
  git('add', file);
  git('commit', '-qm', file);
}

beforeEach(async () => {
  t = await createTestDb();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-step-base-')));
  root = path.join(base, 'work');
  execFileSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  commit('notes.txt', 'one\n');
  git('remote', 'add', 'origin', path.join(base, 'remote.git'));
  git('push', '-q', 'origin', 'main');
  git('checkout', '-qb', BRANCH);
  const linked = await linkedConversation(t, root);
  conversationId = linked.conversationId;
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId,
    projectId: linked.projectId,
    repoRoot: root,
    path: root,
    branch: BRANCH,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
});

afterEach(async () => {
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

async function openPull() {
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, base, head_sha, pr_state)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'notes', 7,
       'https://github.com/acme/notes/pull/7', $4, 'main', 'sha1', 'open')`,
    [randomUUID(), t.workspaceId, conversationId, BRANCH],
  );
}

describe('what a workflow step may bring in from its base', () => {
  it('allows a rebase only while the branch is not on the remote', async () => {
    expect(await stepBaseUpdate(t.db, root)).toEqual({ base: 'main', rebase: true });
    expect(await chatBaseUpdate(t.db, conversationId)).toEqual({ base: 'main', rebase: true });
    git('push', '-q', 'origin', BRANCH);
    expect(await stepBaseUpdate(t.db, root)).toEqual({ base: 'main', rebase: false });
  });

  it('allows no rebase while the branch has an open pull request', async () => {
    await openPull();
    expect(await stepBaseUpdate(t.db, root)).toEqual({ base: 'main', rebase: false });
  });

  it('allows nothing outside a chat’s own worktree', async () => {
    expect(await stepBaseUpdate(t.db, base)).toBeNull();
    expect(await stepBaseUpdate(t.db, null)).toBeNull();
  });

  it('leaves what a merge brought in out of the step’s kept changes', async () => {
    const runId = await sendDo(t, conversationId, 'tidy');
    await takeSnapshot(t.db, runId, root);
    git('checkout', '-q', 'main');
    commit('upstream.txt', 'from main\n');
    git('checkout', '-q', BRANCH);
    git('merge', '-q', '--no-edit', 'main');
    commit('mine.txt', 'step\n');
    const changes = await runChanges(t.db, t.workspaceId, runId, true);
    expect(changes.files.map((file) => file.path)).toEqual(['mine.txt']);
  });
});
