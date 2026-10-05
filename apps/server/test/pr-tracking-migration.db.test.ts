import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { watchesForConversation } from '../src/persistence/pr-watches.ts';
import { trackedPullsOf } from '../src/persistence/tracked-pulls.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const TRACKING_MIGRATION = '0132_chat_pull_requests.sql';
const BRANCH = 'spark/tidy-the-notes-0a1b2c3d';
const url = (number: number) => `https://github.com/acme/widgets/pull/${number}`;

async function oldWatch(db: Db, workspaceId: string, chat: string, task: string, number: number) {
  await db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo,
       number, url, branch, doing, checks, rounds)
     VALUES ($1, $2, $3, $4, 'github.com', 'acme', 'widgets', $5, $6, $7,
       'Watching checks and reviews.', 'failing', 1)`,
    [randomUUID(), workspaceId, chat, task, number, url(number), BRANCH],
  );
}

describe('upgrading to pull request tracking', () => {
  const state = migratedUpTo(TRACKING_MIGRATION);

  it('keeps the pull requests Spark already watched, with who opened them', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const chat = await oldConversation(db, workspaceId);
    const taskId = randomUUID();
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      chat.id,
      'Tidy the notes',
    ]);
    await oldWatch(db, workspaceId, chat.id, taskId, 7);
    await oldWatch(db, workspaceId, chat.id, taskId, 8);
    await db.query(
      `INSERT INTO task_links (id, task_id, kind, url, title, source)
       VALUES ($1, $2, 'pr', $3, 'acme/widgets#8', 'tool_output')`,
      [randomUUID(), taskId, url(8)],
    );

    await runMigrations(db);

    const pulls = await trackedPullsOf(db, workspaceId, chat.id);
    expect(pulls.toSorted((a, b) => a.number - b.number)).toMatchObject([
      {
        number: 7,
        openedVia: 'ship',
        followUp: true,
        outside: false,
        checks: 'failing',
        rounds: 1,
      },
      { number: 8, openedVia: 'agent', followUp: true, branch: BRANCH, failingChecks: [] },
    ]);
    expect(await watchesForConversation(db, workspaceId, chat.id)).toHaveLength(2);
    await expect(oldWatch(db, workspaceId, chat.id, taskId, 7)).rejects.toThrow(/pr_watches_pull/);
  });
});
