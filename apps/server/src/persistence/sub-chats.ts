import {
  SUB_CHATS_STARTED_ACTIVITY,
  heldReason,
  subChatsStartSchema,
  subChatReportSchema,
  subChatStartedWithSchema,
  type ChatRef,
  type ConversationSummary,
  type SubChatPullRequest,
  type SubChatReport,
  type SubChatRow,
  type SubChatStartedWith,
  type SubChatsStart,
} from '@spark-outpost/contracts';
import { withChatBranches } from './chat-worktrees.ts';
import type { Queryable } from './db.ts';
import { toConversationSummary, type ConversationSummaryRow } from './rows.ts';
import { planOf } from './sub-chat-plans.ts';
import { summaryQuery } from './summary-query.ts';

export class SubChatError extends Error {}

const PARENT_NOT_FOUND = 'That chat does not exist. It may have been deleted.';
export const SUB_CHAT_CANNOT_BE_PARENT = 'A sub-chat cannot start sub-chats.';
export const PARENT_CANNOT_BE_SUB_CHAT = 'A chat that has sub-chats cannot become a sub-chat.';
export const ALREADY_A_SUB_CHAT = 'That chat is already a sub-chat.';

const TURN_FAILED = 'Its last turn failed.';
const TURN_STOPPED = 'Its last turn was stopped.';

export interface NewSubChat {
  conversationId: string;
  parentConversationId: string;
  task: string;
  stackedOn: string | null;
  startsAfter: readonly string[];
  startedWith: SubChatStartedWith;
  approvalId: string | null;
}

export interface StoredSubChat {
  conversationId: string;
  parentConversationId: string | null;
  parentTitle: string;
  position: number;
  task: string;
  stackedOn: string | null;
  startsAfter: string[];
  startedAt: Date | null;
  startedWith: SubChatStartedWith;
  taskAskId: string | null;
  report: SubChatReport | null;
  reportedAt: Date | null;
}

interface SubChatDbRow {
  conversation_id: string;
  parent_conversation_id: string | null;
  parent_title: string;
  position: number;
  task: string;
  stacked_on: string | null;
  starts_after: string[];
  started_at: Date | null;
  started_with: unknown;
  task_ask_id: string | null;
  report: unknown;
  reported_at: Date | null;
}

interface PullRow {
  conversation_id: string;
  number: number;
  url: string;
  pr_state: SubChatPullRequest['state'];
  checks: SubChatPullRequest['checks'];
}

const COLUMNS = `conversation_id, parent_conversation_id, parent_title, position, task, stacked_on,
  starts_after, started_at, started_with, task_ask_id, report, reported_at`;

function toStored(row: SubChatDbRow): StoredSubChat {
  return {
    conversationId: row.conversation_id,
    parentConversationId: row.parent_conversation_id,
    parentTitle: row.parent_title,
    position: row.position,
    task: row.task,
    stackedOn: row.stacked_on,
    startsAfter: row.starts_after,
    startedAt: row.started_at,
    startedWith: subChatStartedWithSchema.parse(row.started_with),
    taskAskId: row.task_ask_id,
    report: subChatReportSchema.safeParse(row.report).data ?? null,
    reportedAt: row.reported_at,
  };
}

export async function notifySubChatsChanged(
  db: Queryable,
  conversationId: string | null,
): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'sub_chats_changed', conversationId, runId: null }),
  ]);
}

const IS_SUB_CHAT = 'SELECT 1 FROM sub_chats WHERE conversation_id = $1';
const HAS_SUB_CHATS = 'SELECT 1 FROM sub_chats WHERE parent_conversation_id = $1';

async function exists(client: Queryable, sql: string, id: string): Promise<boolean> {
  return ((await client.query(sql, [id])).rowCount ?? 0) > 0;
}

async function lockedParentTitle(client: Queryable, input: NewSubChat): Promise<string> {
  const { rows } = await client.query<{ id: string; title: string }>(
    'SELECT id, title FROM conversations WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [[input.parentConversationId, input.conversationId]],
  );
  const parent = rows.find((row) => row.id === input.parentConversationId);
  if (!parent) throw new SubChatError(PARENT_NOT_FOUND);
  return parent.title;
}

export async function insertSubChat(client: Queryable, input: NewSubChat): Promise<number> {
  const parentTitle = await lockedParentTitle(client, input);
  if (await exists(client, IS_SUB_CHAT, input.parentConversationId)) {
    throw new SubChatError(SUB_CHAT_CANNOT_BE_PARENT);
  }
  if (await exists(client, HAS_SUB_CHATS, input.conversationId)) {
    throw new SubChatError(PARENT_CANNOT_BE_SUB_CHAT);
  }
  const inserted = await client.query<{ position: number }>(
    `INSERT INTO sub_chats (conversation_id, parent_conversation_id, parent_title, position, task,
       stacked_on, starts_after, started_with, approval_id)
     SELECT $1, $2, $3,
       (SELECT COALESCE(max(position) + 1, 0) FROM sub_chats WHERE parent_conversation_id = $2),
       $4, $5, $6::uuid[], $7, $8
     ON CONFLICT (conversation_id) DO NOTHING
     RETURNING position`,
    [
      input.conversationId,
      input.parentConversationId,
      parentTitle,
      input.task,
      input.stackedOn,
      input.startsAfter,
      JSON.stringify(input.startedWith),
      input.approvalId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new SubChatError(ALREADY_A_SUB_CHAT);
  await notifySubChatsChanged(client, input.parentConversationId);
  return row.position;
}

export async function listSubChats(
  db: Queryable,
  parentConversationId: string,
): Promise<StoredSubChat[]> {
  const { rows } = await db.query<SubChatDbRow>(
    `SELECT ${COLUMNS} FROM sub_chats WHERE parent_conversation_id = $1
     ORDER BY position, created_at`,
    [parentConversationId],
  );
  return rows.map(toStored);
}

export async function getSubChat(
  db: Queryable,
  conversationId: string,
): Promise<StoredSubChat | null> {
  const { rows } = await db.query<SubChatDbRow>(
    `SELECT ${COLUMNS} FROM sub_chats WHERE conversation_id = $1`,
    [conversationId],
  );
  return rows[0] ? toStored(rows[0]) : null;
}

async function changed(
  db: Queryable,
  update: string,
  values: readonly unknown[],
): Promise<boolean> {
  const { rows } = await db.query<{ parent_conversation_id: string | null }>(
    `${update} RETURNING parent_conversation_id`,
    [...values],
  );
  if (!rows[0]) return false;
  await notifySubChatsChanged(db, rows[0].parent_conversation_id);
  return true;
}

export async function markSubChatStarted(
  db: Queryable,
  conversationId: string,
  taskAskId: string,
): Promise<boolean> {
  return changed(
    db,
    `UPDATE sub_chats SET started_at = now(), task_ask_id = $2, wrapped_up_at = NULL
     WHERE conversation_id = $1 AND started_at IS NULL`,
    [conversationId, taskAskId],
  );
}

export async function saveSubChatReport(
  db: Queryable,
  conversationId: string,
  report: SubChatReport,
): Promise<boolean> {
  return changed(
    db,
    'UPDATE sub_chats SET report = $2, reported_at = now() WHERE conversation_id = $1',
    [conversationId, JSON.stringify(report)],
  );
}

export async function saveSubChatReportRecord(
  db: Queryable,
  conversationId: string,
  report: SubChatReport,
): Promise<boolean> {
  return changed(db, 'UPDATE sub_chats SET report = $2 WHERE conversation_id = $1', [
    conversationId,
    JSON.stringify(report),
  ]);
}

export async function claimWrapUp(
  db: Queryable,
  parentConversationId: string,
  subChatIds: readonly string[],
): Promise<boolean> {
  return changed(
    db,
    `UPDATE sub_chats SET wrapped_up_at = now()
     WHERE parent_conversation_id = $1 AND conversation_id = ANY($2::uuid[])
       AND wrapped_up_at IS NULL`,
    [parentConversationId, subChatIds],
  );
}

export async function leaveDeletedParent(
  client: Queryable,
  parentConversationId: string,
): Promise<void> {
  await client.query(
    `UPDATE sub_chats sc SET parent_title = c.title, approval_id = NULL FROM conversations c
     WHERE c.id = $1 AND sc.parent_conversation_id = c.id`,
    [parentConversationId],
  );
}

async function summariesOf(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, ConversationSummary>> {
  const { rows } = await db.query<ConversationSummaryRow>(
    `${summaryQuery} WHERE c.id = ANY($1::uuid[])`,
    [ids],
  );
  const summaries = await withChatBranches(db, rows.map(toConversationSummary));
  return new Map(summaries.map((summary) => [summary.id, summary]));
}

async function pullRequestsOf(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, SubChatPullRequest>> {
  const { rows } = await db.query<PullRow>(
    `SELECT DISTINCT ON (conversation_id) conversation_id, number, url, pr_state, checks
     FROM pr_watches WHERE conversation_id = ANY($1::uuid[])
     ORDER BY conversation_id, (pr_state = 'open') DESC, created_at DESC`,
    [ids],
  );
  return new Map(
    rows.map((row) => [
      row.conversation_id,
      { number: row.number, url: row.url, state: row.pr_state, checks: row.checks },
    ]),
  );
}

function whyNeedsUser(summary: ConversationSummary): string | null {
  if (summary.subChat?.status !== 'needs_you') return null;
  if (summary.attention) return summary.attention.title;
  const run = summary.latestRun;
  if (run?.status === 'cancelled') return TURN_STOPPED;
  return run?.error ?? TURN_FAILED;
}

function refsTo(ids: readonly string[], chats: Map<string, ConversationSummary>): ChatRef[] {
  return ids.flatMap((id) => {
    const chat = chats.get(id);
    return chat ? [{ id, title: chat.title }] : [];
  });
}

async function heldReasons(
  db: Queryable,
  parentConversationId: string | null,
): Promise<Map<string, string>> {
  if (parentConversationId === null) return new Map();
  const pieces = await planOf(db, parentConversationId);
  const plan = new Map(pieces.map((piece) => [piece.id, piece]));
  return new Map(
    pieces.flatMap((piece) => {
      const reason = heldReason(piece, plan);
      return reason === null ? [] : [[piece.id, reason] as const];
    }),
  );
}

export async function subChatRow(db: Queryable, conversationId: string) {
  const stored = await getSubChat(db, conversationId);
  if (!stored) return null;
  const rows = stored.parentConversationId
    ? await subChatRows(db, stored.parentConversationId)
    : await rowsOf(db, [stored], null);
  return rows.find((row) => row.id === conversationId) ?? null;
}

export async function subChatRows(
  db: Queryable,
  parentConversationId: string,
): Promise<SubChatRow[]> {
  return rowsOf(db, await listSubChats(db, parentConversationId), parentConversationId);
}

async function rowsOf(
  db: Queryable,
  stored: readonly StoredSubChat[],
  parentConversationId: string | null,
): Promise<SubChatRow[]> {
  const ids = stored.map((piece) => piece.conversationId);
  if (ids.length === 0) return [];
  const [chats, pulls, held] = await Promise.all([
    summariesOf(db, ids),
    pullRequestsOf(db, ids),
    heldReasons(db, parentConversationId),
  ]);
  return stored.flatMap((piece) => {
    const chat = chats.get(piece.conversationId);
    if (!chat?.subChat) return [];
    return [
      {
        id: piece.conversationId,
        title: chat.title,
        position: piece.position,
        status: chat.subChat.status,
        why: whyNeedsUser(chat) ?? held.get(piece.conversationId) ?? null,
        task: piece.task,
        branch: chat.branch ?? null,
        pullRequest: pulls.get(piece.conversationId) ?? null,
        startedWith: piece.startedWith,
        stackedOn: refsTo(piece.stackedOn ? [piece.stackedOn] : [], chats)[0] ?? null,
        startsAfter: refsTo(piece.startsAfter, chats),
        startedAt: piece.startedAt ? piece.startedAt.toISOString() : null,
        report: piece.report,
        reportedAt: piece.reportedAt ? piece.reportedAt.toISOString() : null,
      },
    ];
  });
}

export async function listSubChatStarts(
  db: Queryable,
  conversationId: string,
): Promise<SubChatsStart[]> {
  const { rows } = await db.query<{ run_id: string; content: unknown }>(
    `SELECT e.run_id, e.payload->'content' AS content
     FROM run_events e
     JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = $1
       AND e.type = 'ACTIVITY_SNAPSHOT' AND e.payload->>'activityType' = $2
     ORDER BY e.created_at, e.seq`,
    [conversationId, SUB_CHATS_STARTED_ACTIVITY],
  );
  return rows.flatMap((row) => {
    const start = subChatsStartSchema.safeParse({ ...Object(row.content), runId: row.run_id });
    return start.success ? [start.data] : [];
  });
}
