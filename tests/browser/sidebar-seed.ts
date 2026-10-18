import { randomUUID } from 'node:crypto';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb } from './database.ts';

export interface SeedApproval {
  kind: string;
  title: string;
  command?: string;
  paths?: string[];
  diffs?: { path: string; oldText: string | null; newText: string }[];
  plan?: string;
  checkpoint?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  options?: { optionId: string; name: string; kind: string }[];
}

export interface SeedChat {
  id?: string;
  title: string;
  message?: string;
  projectIds?: string[];
  archived?: boolean;
  unread?: boolean;
  run?: { status: string; error?: string };
  approval?: SeedApproval;
  approvals?: SeedApproval[];
  minutesAgo?: number;
}

const APPROVAL_OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
];

async function insertApproval(
  db: Db,
  run: { id: string },
  approval: SeedApproval,
  seq: number,
): Promise<void> {
  const id = randomUUID();
  const payload = {
    command: approval.command ?? null,
    cwd: null,
    paths: approval.paths ?? [],
    diffs: approval.diffs ?? [],
    truncated: false,
    ...(approval.plan ? { plan: approval.plan } : {}),
    ...(approval.checkpoint ? { checkpoint: approval.checkpoint } : {}),
    ...approval.payload,
  };
  const options = approval.options ?? APPROVAL_OPTIONS;
  const toolCallId = `seed:${id}`;
  const { rows } = await db.query<{ created_at: Date }>(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status)
     VALUES ($1, $2, $3, $4, $5, $6, 'sha256:seed', $7, 'pending')
     RETURNING created_at`,
    [
      id,
      run.id,
      toolCallId,
      approval.kind,
      approval.title,
      JSON.stringify(payload),
      JSON.stringify(options),
    ],
  );
  const requested = {
    type: 'CUSTOM',
    name: 'approval_requested',
    value: {
      id,
      runId: run.id,
      toolCallId,
      kind: approval.kind,
      title: approval.title,
      payload,
      payloadHash: 'sha256:seed',
      options,
      status: 'pending',
      reason: null,
      decisionOptionId: null,
      scope: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: rows[0]!.created_at.toISOString(),
      note: null,
    },
  };
  await db.query(`INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, $2, $3, $4)`, [
    run.id,
    seq,
    requested.type,
    JSON.stringify(requested),
  ]);
}

async function insertApprovals(
  db: Db,
  run: { id: string; conversationId: string },
  approvals: readonly SeedApproval[],
): Promise<void> {
  const started = { type: 'RUN_STARTED', runId: run.id, threadId: run.conversationId };
  await db.query(`INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, 1, $2, $3)`, [
    run.id,
    started.type,
    JSON.stringify(started),
  ]);
  for (const [index, approval] of approvals.entries()) {
    await insertApproval(db, run, approval, index + 2);
  }
}

export async function seedChats(chats: readonly SeedChat[]): Promise<string[]> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const ids: string[] = [];
    for (const chat of chats) {
      const id = chat.id ?? randomUUID();
      const messageId = randomUUID();
      const updated = new Date(Date.now() - (chat.minutesAgo ?? ids.length) * 60_000);
      await db.query(
        `INSERT INTO conversations (id, workspace_id, title, updated_at, archived_at, seen_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN NULL ELSE now() - interval '1 second' END)`,
        [
          id,
          workspaceId,
          chat.title,
          updated,
          chat.archived ? updated : null,
          chat.unread ?? false,
        ],
      );
      await db.query(
        `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
        [messageId, id, chat.message ?? chat.title],
      );
      for (const [position, projectId] of (chat.projectIds ?? []).entries()) {
        await db.query(
          `INSERT INTO conversation_projects (conversation_id, project_id, position)
           VALUES ($1, $2, $3)`,
          [id, projectId, position],
        );
      }
      if (chat.run) {
        const runId = randomUUID();
        await db.query(
          `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, error,
             started_at, finished_at)
           VALUES ($1, $2, $3, 'fake', $4, $5, now(), CASE WHEN $6 THEN now() END)`,
          [runId, id, messageId, chat.run.status, chat.run.error ?? null, chat.unread ?? false],
        );
        const approvals = [...(chat.approval ? [chat.approval] : []), ...(chat.approvals ?? [])];
        if (approvals.length > 0) {
          await insertApprovals(db, { id: runId, conversationId: id }, approvals);
        }
      }
      ids.push(id);
    }
    return ids;
  } finally {
    await db.end();
  }
}
