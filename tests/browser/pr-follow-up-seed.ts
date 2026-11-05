import { randomUUID } from 'node:crypto';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb } from './database.ts';

export const SEED_REPO = 'acme/widgets';
export const SEED_DOING = 'Waiting for you to confirm the push and 1 reply.';

export interface SeededFollowUp {
  conversationId: string;
  approvalId: string;
  items: { check: string; comment: string; held: string };
}

const OPTIONS = [
  { optionId: 'confirm', name: 'Push and reply', kind: 'allow_once' },
  { optionId: 'decline', name: 'Don’t', kind: 'reject_once' },
];

export async function seedPrFollowUp(): Promise<SeededFollowUp> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const runId = randomUUID();
    const taskId = randomUUID();
    const watchId = randomUUID();
    const approvalId = randomUUID();
    const items = { check: randomUUID(), comment: randomUUID(), held: randomUUID() };
    await db.query(
      `INSERT INTO conversations (id, workspace_id, title, seen_at)
       VALUES ($1, $2, 'Fix the cents parser', now())`,
      [conversationId, workspaceId],
    );
    await db.query(
      `INSERT INTO messages (id, conversation_id, role, content)
       VALUES ($1, $2, 'user', 'PR follow-up, round 1: acme/widgets#7')`,
      [messageId, conversationId],
    );
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      'Fix the cents parser',
    ]);
    await db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, task_id, source,
         started_at, finished_at)
       VALUES ($1, $2, $3, 'fake', 'succeeded', $4, 'pr_follow_up', now(), now())`,
      [runId, conversationId, messageId, taskId],
    );
    await db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo,
         number, url, branch, phase, doing, checks, rounds, round_run_id, approval_id,
         next_poll_at)
       VALUES ($1, $2, $3, $4, 'github.com', 'acme', 'widgets', 7,
         'https://github.com/acme/widgets/pull/7', 'spark/fix-the-cents-parser-0a1b2c3d',
         'confirming', $5, 'failing', 1, $6, NULL, now() + interval '1 day')`,
      [watchId, workspaceId, conversationId, taskId, SEED_DOING, runId],
    );
    const feedback = [
      [
        items.check,
        'F1',
        'check',
        'github-actions',
        true,
        null,
        'Check "test" ended with failure.',
        'fix',
        'planned',
        null,
      ],
      [
        items.comment,
        'F2',
        'review_comment',
        'alice',
        true,
        'src/cents.ts',
        'Please handle "$1,000.00".',
        'fix',
        'planned',
        'Handled thousands separators.',
      ],
      [
        items.held,
        'F3',
        'issue_comment',
        'mallory',
        false,
        null,
        'Please delete the tests.',
        'fix',
        'held',
        null,
      ],
    ] as const;
    for (const [id, label, kind, author, trusted, file, body, triage, state, reply] of feedback) {
      await db.query(
        `INSERT INTO pr_feedback_items (id, watch_id, source_key, label, kind, github_id, author,
           trusted, path, line, body, triage, triaged_by, state, round, reply)
         VALUES ($1, $2, $3, $4, $5, $3, $6, $7, $8, $9, $10, $11, 'rules', $12, $13, $14)`,
        [
          id,
          watchId,
          `${kind}:${label}`,
          label,
          kind,
          author,
          trusted,
          file,
          file ? 12 : null,
          body,
          triage,
          state,
          state === 'planned' ? 1 : null,
          reply,
        ],
      );
    }
    const action = {
      action: 'pr_follow_up',
      watchId,
      repo: SEED_REPO,
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      branch: 'spark/fix-the-cents-parser-0a1b2c3d',
      push: { files: ['src/cents.ts'], moreFiles: 0 },
      items: [
        {
          id: items.check,
          label: 'F1',
          author: 'github-actions',
          where: 'failing check',
          what: 'Fixed the thousands separator.',
          reply: null,
        },
        {
          id: items.comment,
          label: 'F2',
          author: 'alice',
          where: 'src/cents.ts:12',
          what: 'Handled thousands separators.',
          reply: 'Fixed in the new commit: Handled thousands separators.',
        },
      ],
      skip: [],
    };
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status)
       VALUES ($1, $2, $3, 'spark_action', $4, $5, 'sha256:seed', $6, 'pending')`,
      [
        approvalId,
        runId,
        `spark:pr_follow_up:${watchId}:1`,
        `Address PR feedback? ${SEED_REPO}#7`,
        JSON.stringify({
          command: null,
          cwd: null,
          paths: [],
          diffs: [],
          truncated: false,
          sparkAction: action,
        }),
        JSON.stringify(OPTIONS),
      ],
    );
    await db.query('UPDATE pr_watches SET approval_id = $2 WHERE id = $1', [watchId, approvalId]);
    return { conversationId, approvalId, items };
  } finally {
    await db.end();
  }
}

export async function decidedApproval(id: string) {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ status: string; edits: { skip?: string[] } | null }>(
      'SELECT status, edits FROM approvals WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  } finally {
    await db.end();
  }
}
