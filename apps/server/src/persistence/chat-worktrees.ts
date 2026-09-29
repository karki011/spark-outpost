import {
  DEFAULT_WORK_PLACE,
  workPlaceSchema,
  type ConversationSummary,
  type WorkPlace,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface ChatWorktree {
  id: string;
  conversationId: string | null;
  projectId: string;
  repoRoot: string;
  path: string;
  branch: string;
  baseBranch: string | null;
  baseCommit: string;
  landedCommit: string | null;
  inPlace: boolean;
  ownsBranch: boolean;
}

interface Row {
  id: string;
  conversation_id: string | null;
  project_id: string;
  repo_root: string;
  path: string;
  branch: string;
  base_branch: string | null;
  base_commit: string;
  landed_commit: string | null;
  in_place: boolean;
  owns_branch: boolean;
}

function toRecord(row: Row): ChatWorktree {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    repoRoot: row.repo_root,
    path: row.path,
    branch: row.branch,
    baseBranch: row.base_branch,
    baseCommit: row.base_commit,
    landedCommit: row.landed_commit,
    inPlace: row.in_place,
    ownsBranch: row.owns_branch,
  };
}

export async function insertChatWorktree(db: Queryable, record: ChatWorktree): Promise<void> {
  await db.query(
    `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
       base_branch, base_commit, in_place, owns_branch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      record.id,
      record.conversationId,
      record.projectId,
      record.repoRoot,
      record.path,
      record.branch,
      record.baseBranch,
      record.baseCommit,
      record.inPlace,
      record.ownsBranch,
    ],
  );
}

export async function liveChatWorktree(
  db: Queryable,
  conversationId: string,
  projectId: string,
): Promise<ChatWorktree | null> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM chat_worktrees
     WHERE conversation_id = $1 AND project_id = $2 AND removed_at IS NULL`,
    [conversationId, projectId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function primaryChatWorktree(
  db: Queryable,
  conversationId: string,
): Promise<ChatWorktree | null> {
  const { rows } = await db.query<Row>(
    `SELECT cw.* FROM chat_worktrees cw
     JOIN conversation_projects cp
       ON cp.conversation_id = cw.conversation_id AND cp.project_id = cw.project_id
     WHERE cw.conversation_id = $1 AND cw.removed_at IS NULL
     ORDER BY cp.position, cp.created_at LIMIT 1`,
    [conversationId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function chatWorktreeAt(db: Queryable, path: string): Promise<ChatWorktree | null> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM chat_worktrees WHERE path = $1 AND removed_at IS NULL AND NOT in_place',
    [path],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function chatWorktreesOf(
  db: Queryable,
  conversationId: string,
): Promise<ChatWorktree[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM chat_worktrees WHERE conversation_id = $1 AND removed_at IS NULL',
    [conversationId],
  );
  return rows.map(toRecord);
}

export async function sweepableChatWorktrees(db: Queryable): Promise<ChatWorktree[]> {
  const { rows } = await db.query<Row>(
    `SELECT cw.* FROM chat_worktrees cw
     WHERE cw.removed_at IS NULL AND NOT cw.in_place
       AND NOT EXISTS (
         SELECT 1 FROM runs r WHERE r.conversation_id = cw.conversation_id
           AND r.status IN ('queued', 'running', 'awaiting_approval'))
     ORDER BY cw.created_at`,
  );
  return rows.map(toRecord);
}

export async function archivedOrDeleted(db: Queryable, conversationId: string | null) {
  if (!conversationId) return true;
  const { rows } = await db.query<{ archived: boolean }>(
    'SELECT archived_at IS NOT NULL AS archived FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.archived ?? true;
}

export async function allLiveChatWorktrees(db: Queryable): Promise<ChatWorktree[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM chat_worktrees WHERE removed_at IS NULL AND NOT in_place ORDER BY created_at',
  );
  return rows.map(toRecord);
}

export async function markChatWorktreeRemoved(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE chat_worktrees SET removed_at = now() WHERE id = $1', [id]);
}

export async function saveLanded(db: Queryable, id: string, commit: string): Promise<void> {
  await db.query('UPDATE chat_worktrees SET landed_commit = $2 WHERE id = $1', [id, commit]);
}

export interface PlaceChoice {
  place: WorkPlace;
  branch: string | null;
}

export async function placeChoice(
  db: Queryable,
  conversationId: string,
  projectId: string | null,
): Promise<PlaceChoice> {
  const { rows } = await db.query<{
    chat: string | null;
    project: string | null;
    branch: string | null;
  }>(
    `SELECT c.work_place AS chat, c.work_branch AS branch,
       (SELECT p.work_place FROM projects p WHERE p.id = $2) AS project
     FROM conversations c WHERE c.id = $1`,
    [conversationId, projectId],
  );
  const row = rows[0];
  const place = workPlaceSchema.safeParse(row?.chat ?? row?.project).data ?? DEFAULT_WORK_PLACE;
  return { place, branch: row?.branch ?? null };
}

export async function savePlaceChoice(
  db: Queryable,
  conversationId: string,
  projectId: string | null,
  change: { place?: WorkPlace | undefined; branch?: string | null | undefined },
): Promise<void> {
  if (change.place !== undefined) {
    await db.query('UPDATE conversations SET work_place = $2 WHERE id = $1', [
      conversationId,
      change.place,
    ]);
    if (projectId) {
      await db.query('UPDATE projects SET work_place = $2 WHERE id = $1', [
        projectId,
        change.place,
      ]);
    }
  }
  if (change.branch !== undefined) {
    await db.query('UPDATE conversations SET work_branch = $2 WHERE id = $1', [
      conversationId,
      change.branch,
    ]);
  }
}

export async function withChatBranches(
  db: Queryable,
  summaries: ConversationSummary[],
): Promise<ConversationSummary[]> {
  if (summaries.length === 0) return summaries;
  const { rows } = await db.query<{ conversation_id: string; branch: string }>(
    `SELECT DISTINCT ON (conversation_id) conversation_id, branch FROM chat_worktrees
     WHERE conversation_id = ANY($1::uuid[]) AND removed_at IS NULL
     ORDER BY conversation_id, created_at`,
    [summaries.map((summary) => summary.id)],
  );
  const branches = new Map(rows.map((row) => [row.conversation_id, row.branch]));
  return summaries.map((summary) => ({ ...summary, branch: branches.get(summary.id) ?? null }));
}
