import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { TEAMMATE_COLORS, TEAMMATE_SHAPES } from '../../packages/contracts/src/teammates.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats, type SeedApproval } from './sidebar-seed.ts';
import { FAKE_GH_STATE } from './stub-config.ts';
import { STUB_URL } from './ticket-seed.ts';

type Source = 'linear' | 'jira';

interface FlowChat {
  key: string;
  source: Source;
  status: 'running' | 'succeeded' | 'failed' | 'awaiting_approval';
  approval?: SeedApproval;
  plan?: string[];
  spark?: string;
  pull?: { number: number; checks: 'passing' | 'failing' };
}

export interface LinkedChat {
  conversationId: string;
  taskId: string;
  runId: string;
}

const PULL_URL = (number: number) => `https://github.com/acme/widgets/pull/${number}`;

const CHECK_RUNS = {
  passing: [{ status: 'completed', conclusion: 'success' }],
  failing: [{ status: 'completed', conclusion: 'failure' }],
};

export async function setPullChecks(number: number, checks: 'passing' | 'failing') {
  await fetch(`${STUB_URL}/github-test/pulls/${number}`, {
    method: 'POST',
    body: JSON.stringify({ checkRuns: CHECK_RUNS[checks] }),
  });
}

async function addPull(number: number, checks: 'passing' | 'failing') {
  await fetch(`${STUB_URL}/github-test/pulls`, {
    method: 'POST',
    body: JSON.stringify({ number, checkRuns: CHECK_RUNS[checks] }),
  });
}

async function linkChat(chat: FlowChat, conversationId: string): Promise<LinkedChat> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const taskId = randomUUID();
    await db.query(
      `INSERT INTO tickets (workspace_id, source, key, title, status, status_name, url, updated_at)
       VALUES ($1, $2, $3, $3, 'todo', 'Todo', '', now())
       ON CONFLICT (workspace_id, source, key) DO NOTHING`,
      [workspaceId, chat.source, chat.key],
    );
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      chat.key,
    ]);
    await db.query(
      `INSERT INTO task_tickets (task_id, workspace_id, source, ticket_key) VALUES ($1, $2, $3, $4)`,
      [taskId, workspaceId, chat.source, chat.key],
    );
    if (chat.pull) {
      await db.query(
        `INSERT INTO task_links (id, task_id, kind, url, title, source)
         VALUES ($1, $2, 'pr', $3, $3, 'ship')`,
        [randomUUID(), taskId, PULL_URL(chat.pull.number)],
      );
    }
    if (chat.spark) {
      const teammateId = randomUUID();
      await db.query(
        `INSERT INTO teammates (id, workspace_id, name, role, face_shape, face_color)
         VALUES ($1, $2, $3, 'Builder', $4, $5)`,
        [teammateId, workspaceId, chat.spark, TEAMMATE_SHAPES[1], TEAMMATE_COLORS[2]],
      );
      await db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [
        conversationId,
        teammateId,
      ]);
    }
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId],
    );
    return { conversationId, taskId, runId: rows[0]!.id };
  } finally {
    await db.end();
  }
}

export async function seedFlowChats(chats: readonly FlowChat[]): Promise<LinkedChat[]> {
  if (chats.some((chat) => chat.pull)) writeFileSync(FAKE_GH_STATE, 'octo-cli');
  const ids = await seedChats(
    chats.map((chat) => ({
      title: `Work on ${chat.key}`,
      run: { status: chat.status },
      ...(chat.approval ? { approval: chat.approval } : {}),
    })),
  );
  const linked: LinkedChat[] = [];
  for (const [index, chat] of chats.entries()) {
    const conversationId = ids[index]!;
    await decorateLatestRun(conversationId, {
      provider: 'claude',
      ...(chat.plan ? { plan: chat.plan } : {}),
    });
    if (chat.pull) await addPull(chat.pull.number, chat.pull.checks);
    linked.push(await linkChat(chat, conversationId));
  }
  return linked;
}

export async function askForPlanApproval(chat: LinkedChat): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status)
       VALUES ($1, $2, $3, 'plan', 'Approve the plan', '{}', 'sha256:seed', '[]', 'pending')`,
      [randomUUID(), chat.runId, `seed:${randomUUID()}`],
    );
  } finally {
    await db.end();
  }
}

export async function watchPull(chat: LinkedChat, number: number): Promise<string> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const id = randomUUID();
    await db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo,
         number, url, branch, checks, next_poll_at)
       VALUES ($1, $2, $3, $4, 'github.com', 'acme', 'widgets', $5, $6, $7, 'passing',
         now() + interval '1 day')`,
      [id, workspaceId, chat.conversationId, chat.taskId, number, PULL_URL(number), `pr-${number}`],
    );
    return id;
  } finally {
    await db.end();
  }
}

export async function markWatchChecks(watchId: string, checks: 'passing' | 'failing') {
  const db = openTestDb();
  try {
    await db.query('UPDATE pr_watches SET checks = $2 WHERE id = $1', [watchId, checks]);
  } finally {
    await db.end();
  }
}
