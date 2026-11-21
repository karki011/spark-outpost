import { randomUUID } from 'node:crypto';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { openTestDb } from './database.ts';
import type { SeedChat } from './sidebar-seed.ts';

export const STARTED_WITH = {
  provider: 'fake',
  model: 'sonnet',
  effort: 'medium',
  agentMode: 'auto',
  level: 'full-auto',
};

export interface Piece extends SeedChat {
  started?: boolean;
  pullRequest?: number;
  task?: string;
  branch?: string;
  startedWith?: Partial<typeof STARTED_WITH>;
  stackedOn?: string;
  startsAfter?: string[];
  report?: Record<string, unknown>;
}

export interface PieceLinks {
  projectId: string;
  folder: string;
}

async function inDb<Result>(work: (db: Db, workspaceId: string) => Promise<Result>) {
  const db = openTestDb();
  try {
    return await work(db, await ensureLocalWorkspace(db));
  } finally {
    await db.end();
  }
}

export function linkPieces(
  parent: string | null,
  title: string,
  pieces: readonly Piece[],
  links?: PieceLinks,
): Promise<void> {
  const idOf = (name: string) => pieces.find((piece) => piece.title === name)?.id ?? null;
  return inDb(async (db, workspaceId) => {
    for (const [position, piece] of pieces.entries()) {
      await db.query(
        `INSERT INTO sub_chats (conversation_id, parent_conversation_id, parent_title, position,
           task, started_at, started_with, stacked_on, starts_after, report, reported_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END, $7, $8, $9::uuid[], $10,
           CASE WHEN $10::jsonb IS NULL THEN NULL ELSE now() END)`,
        [
          piece.id,
          parent,
          title,
          position,
          piece.task ?? 'Build this piece.',
          piece.started ?? true,
          JSON.stringify({ ...STARTED_WITH, ...piece.startedWith }),
          piece.stackedOn ? idOf(piece.stackedOn) : null,
          (piece.startsAfter ?? []).map(idOf),
          piece.report ? JSON.stringify(piece.report) : null,
        ],
      );
      if (piece.branch && links) {
        await db.query(
          `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
             base_branch, base_commit, in_place, owns_branch)
           VALUES ($1, $2, $3, $4, $5, $6, 'main', 'seed', false, true)`,
          [
            randomUUID(),
            piece.id,
            links.projectId,
            links.folder,
            `${links.folder}/.spark/worktrees/${piece.id}`,
            piece.branch,
          ],
        );
      }
      if (!piece.pullRequest) continue;
      await db.query(
        `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number,
           url, branch, pr_state, checks)
         VALUES ($1, $2, $3, 'github.com', 'acme', 'shop', $4, $5, $6, 'open', 'passing')`,
        [
          randomUUID(),
          workspaceId,
          piece.id,
          piece.pullRequest,
          `https://github.com/acme/shop/pull/${piece.pullRequest}`,
          piece.branch ?? 'spark/piece',
        ],
      );
    }
  });
}

export interface SeedAsk {
  id?: string;
  kind: 'task' | 'message' | 'reply' | 'report' | 'wrap_up';
  from: { id: string | null; title: string };
  fromRunId?: string | null;
  to: string;
  body: string;
  replyTo?: string | null;
  state?: 'waiting' | 'replied' | 'no_reply' | null;
  deliveredAs?: 'turn' | 'steer' | null;
  runId?: string | null;
  noReplyReason?: string | null;
  report?: Record<string, unknown>;
}

export function seedAsk(ask: SeedAsk): Promise<string> {
  const id = ask.id ?? randomUUID();
  return inDb(async (db, workspaceId) => {
    await db.query(
      `INSERT INTO chat_asks (id, workspace_id, kind, from_conversation_id, from_run_id,
         from_title, to_conversation_id, body, reply_to, state, delivered_as, run_id,
         no_reply_reason, report)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        workspaceId,
        ask.kind,
        ask.from.id,
        ask.fromRunId ?? null,
        ask.from.title,
        ask.to,
        ask.body,
        ask.replyTo ?? null,
        ask.state ?? null,
        ask.deliveredAs ?? null,
        ask.runId ?? null,
        ask.noReplyReason ?? null,
        ask.report ? JSON.stringify(ask.report) : null,
      ],
    );
    return id;
  });
}

export interface SeededTurn {
  runId: string;
  messageId: string;
}

export function firstTurn(conversationId: string): Promise<SeededTurn> {
  return inDb(async (db) => {
    const { rows } = await db.query<{ id: string; user_message_id: string }>(
      `SELECT id, user_message_id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
       ORDER BY created_at LIMIT 1`,
      [conversationId],
    );
    if (!rows[0]) throw new Error('That chat has no turn.');
    return { runId: rows[0].id, messageId: rows[0].user_message_id };
  });
}

export function markChatTurn(runId: string): Promise<void> {
  return inDb(async (db) => {
    await db.query(`UPDATE runs SET source = 'chat' WHERE id = $1`, [runId]);
  });
}

export function seedChatTurn(
  conversationId: string,
  content: string,
  reply: string,
): Promise<SeededTurn> {
  const messageId = randomUUID();
  const runId = randomUUID();
  return inDb(async (db) => {
    await db.query(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [messageId, conversationId, content],
    );
    await db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source,
         started_at, finished_at)
       VALUES ($1, $2, $3, 'fake', 'succeeded', 'chat', now(), now())`,
      [runId, conversationId, messageId],
    );
    await db.query(
      `INSERT INTO messages (id, conversation_id, role, content, run_id)
       VALUES ($1, $2, 'assistant', $3, $4)`,
      [randomUUID(), conversationId, reply, runId],
    );
    return { runId, messageId };
  });
}

export function seedStartedLine(
  runId: string,
  subChats: readonly { id: string; title: string; held: boolean }[],
): Promise<void> {
  return inDb(async (db) => {
    const event = {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: `sub_chats_started:${runId}`,
      activityType: 'sub_chats_started',
      content: { subChats, notStarted: [] },
    };
    await db.query(
      `INSERT INTO run_events (run_id, seq, type, payload)
       VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3)`,
      [runId, event.type, JSON.stringify(event)],
    );
  });
}

export function seedTask(conversationId: string, title: string): Promise<void> {
  return inDb(async (db) => {
    const taskId = randomUUID();
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      conversationId,
      title,
    ]);
    await db.query('UPDATE runs SET task_id = $2 WHERE conversation_id = $1', [
      conversationId,
      taskId,
    ]);
  });
}
