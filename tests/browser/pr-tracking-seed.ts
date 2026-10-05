import { randomUUID } from 'node:crypto';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb } from './database.ts';

export const SEED_TITLE = 'Tidy the notes';

export interface SeededPull {
  owner: string;
  repo: string;
  number: number;
  via: 'agent' | 'terminal' | 'discovery';
  by: string | null;
  inTurn: boolean;
  outside: boolean;
  branch: string;
}

export const SEED_PULLS: readonly SeededPull[] = [
  {
    owner: 'acme',
    repo: 'widgets',
    number: 7,
    via: 'agent',
    by: 'claude',
    inTurn: true,
    outside: false,
    branch: 'spark/tidy-the-notes-0a1b2c3d',
  },
  {
    owner: 'acme',
    repo: 'widgets',
    number: 8,
    via: 'terminal',
    by: 'terminal',
    inTurn: false,
    outside: false,
    branch: 'feature/changelog',
  },
  {
    owner: 'acme',
    repo: 'gadgets',
    number: 3,
    via: 'agent',
    by: 'claude',
    inTurn: true,
    outside: true,
    branch: 'fix-docs',
  },
  {
    owner: 'acme',
    repo: 'vault',
    number: 12,
    via: 'discovery',
    by: null,
    inTurn: false,
    outside: true,
    branch: '',
  },
];

export const pullUrl = (pull: Pick<SeededPull, 'owner' | 'repo' | 'number'>) =>
  `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}`;

export async function seedTrackedPulls(): Promise<{ conversationId: string }> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const runId = randomUUID();
    const taskId = randomUUID();
    await db.query(
      `INSERT INTO conversations (id, workspace_id, title, last_read_at)
       VALUES ($1, $2, $3, now())`,
      [conversationId, workspaceId, SEED_TITLE],
    );
    await db.query(
      `INSERT INTO messages (id, conversation_id, role, content)
       VALUES ($1, $2, 'user', 'Tidy the notes and open pull requests for both repos')`,
      [messageId, conversationId],
    );
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      SEED_TITLE,
    ]);
    await db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, task_id,
         started_at, finished_at)
       VALUES ($1, $2, $3, 'fake', 'succeeded', $4, now(), now())`,
      [runId, conversationId, messageId, taskId],
    );
    await db.query(
      `INSERT INTO messages (id, conversation_id, role, content, run_id)
       VALUES ($1, $2, 'assistant', 'The notes are tidy and both pull requests are open.', $3)`,
      [randomUUID(), conversationId, runId],
    );
    for (const [index, pull] of SEED_PULLS.entries()) {
      await db.query(
        `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo,
           number, url, branch, doing, opened_via, opened_by, opened_run_id, outside, follow_up,
           created_at)
         VALUES ($1, $2, $3, $4, 'github.com', $5, $6, $7, $8, $9,
           'Tracking checks and reviews.', $10, $11, $12, $13, false,
           now() - make_interval(mins => $14))`,
        [
          randomUUID(),
          workspaceId,
          conversationId,
          taskId,
          pull.owner,
          pull.repo,
          pull.number,
          pullUrl(pull),
          pull.branch,
          pull.via,
          pull.by,
          pull.inTurn ? runId : null,
          pull.outside,
          SEED_PULLS.length - index,
        ],
      );
    }
    return { conversationId };
  } finally {
    await db.end();
  }
}

export async function pollTrackedPullsNow(): Promise<void> {
  const db = openTestDb();
  try {
    await db.query("UPDATE pr_watches SET next_poll_at = now() WHERE phase <> 'done'");
    await db.query("SELECT pg_notify('pr_poll', '')");
  } finally {
    await db.end();
  }
}
