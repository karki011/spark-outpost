import {
  agentRoleLabel,
  checkBodySchema,
  failingChecks,
  type Approval,
  type ConversationDetail,
  type CrewMember,
  type Orchestration,
  type Run,
} from '@spark-outpost/contracts';
import { getConversationDetail } from '../persistence/conversations.ts';
import type { Queryable } from '../persistence/db.ts';
import { runChanges } from '../projects/run-changes.ts';
import type { ChatFacts, ChatState } from './update-summary.ts';

export interface LoadedFacts {
  facts: ChatFacts;
  runId: string | null;
}

const LIVE_MEMBER = new Set(['queued', 'running', 'awaiting_approval']);

function stateOf(run: Run | null, detail: ConversationDetail): ChatState {
  if (!run) return 'not_started';
  if (detail.conversation.attention) return 'waiting';
  switch (run.status) {
    case 'queued':
    case 'running':
      return 'running';
    case 'awaiting_approval':
      return 'waiting';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    default:
      return 'stopped';
  }
}

function activeMember(orchestration: Orchestration | null): CrewMember | null {
  const crew = orchestration?.crew ?? [];
  return crew.findLast((member) => LIVE_MEMBER.has(member.status)) ?? crew.at(-1) ?? null;
}

function pendingApproval(detail: ConversationDetail, orchestration: Orchestration | null) {
  const pending: Approval | undefined = detail.approvals.find(
    (approval) => approval.status === 'pending',
  );
  return pending ?? orchestration?.pendingCheckpoint ?? null;
}

function waitingLabel(approval: Approval | null): string | null {
  if (!approval) return null;
  return approval.payload.command ?? approval.payload.paths[0] ?? approval.title;
}

async function changedFiles(
  db: Queryable,
  workspaceId: string,
  runIds: readonly string[],
): Promise<string[]> {
  for (const runId of runIds) {
    const changes = await runChanges(db, workspaceId, runId, true).catch(() => null);
    if (changes && changes.files.length > 0) return changes.files.map((file) => file.path);
  }
  return [];
}

async function latestChecks(db: Queryable, conversationId: string): Promise<ChatFacts['checks']> {
  const { rows } = await db.query<{ body: unknown }>(
    `SELECT a.body FROM run_artifacts a JOIN tasks t ON t.id = a.task_id
     WHERE t.conversation_id = $1 AND a.kind = 'check'
     ORDER BY a.created_at DESC LIMIT 1`,
    [conversationId],
  );
  const parsed = checkBodySchema.safeParse(rows[0]?.body);
  if (!parsed.success) return null;
  return { status: parsed.data.status, failing: failingChecks(parsed.data).length };
}

async function quietMinutes(db: Queryable, conversationId: string, now: Date) {
  const { rows } = await db.query<{ last: Date | null }>(
    `SELECT max(e.created_at) AS last FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = $1`,
    [conversationId],
  );
  const last = rows[0]?.last;
  return last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / 60_000)) : null;
}

export async function loadChatFacts(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  now: Date,
): Promise<LoadedFacts | null> {
  const detail = await getConversationDetail(db, conversationId);
  if (!detail) return null;
  const run = detail.runs.filter((candidate) => !candidate.parentRunId).at(-1) ?? null;
  const orchestration = run ? (detail.orchestrations?.[run.id] ?? null) : null;
  const member = activeMember(orchestration);
  const state = stateOf(run, detail);
  const builders = (orchestration?.crew ?? [])
    .filter((crew) => crew.role === 'builder')
    .map((crew) => crew.runId)
    .reverse();
  const [files, checks, quiet] = await Promise.all([
    run ? changedFiles(db, workspaceId, [run.id, ...builders]) : Promise.resolve([]),
    latestChecks(db, conversationId),
    state === 'running' ? quietMinutes(db, conversationId, now) : Promise.resolve(null),
  ]);
  const summaryRun = detail.conversation.latestRun;
  return {
    runId: run?.id ?? null,
    facts: {
      title: detail.conversation.title,
      state,
      phase: orchestration?.phase ?? null,
      step: summaryRun?.step ?? member?.planStep ?? null,
      agent: member ? { name: member.name, role: agentRoleLabel(member.role) } : null,
      steps: summaryRun?.progress
        ? { done: summaryRun.progress.done, total: summaryRun.progress.total }
        : null,
      files,
      checks,
      costUsd: detail.usageTotals.costUsd,
      waitingOn: waitingLabel(pendingApproval(detail, orchestration)),
      error: run?.error ?? null,
      quietMinutes: quiet,
    },
  };
}
