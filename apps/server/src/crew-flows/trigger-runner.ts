import { workflowProblems, type QueuedTriggerKind } from '@spark-outpost/contracts';
import { sparkPaused } from '../persistence/spark-pause.ts';
import { chatCode, diffHash } from './chat-code.ts';
import { chatTurnActive } from './chat-started.ts';
import { openScheduleChat } from './schedule-records.ts';
import { existingRun, startWorkflowRun, type StartRunDeps } from './start-run.ts';
import { workspaceSparkIds } from './step-sparks.ts';
import { scanPullRequests } from './trigger-events.ts';
import {
  claimDueTriggers,
  getTriggers,
  lastTriggeredHash,
  reclaimStrandedTriggers,
  releaseClaim,
  settleTrigger,
  workflowRunningInChat,
  type ClaimedTrigger,
  type TriggerOutcome,
} from './trigger-records.ts';

export const STRANDED_TRIGGER_MS = 60_000;

export const TRIGGER_MESSAGES: Record<QueuedTriggerKind, string> = {
  turn_changed:
    'Started by this workflow’s trigger: a turn in this chat changed files. Work on this chat’s branch as it is now.',
  commit:
    'Started by this workflow’s trigger: this chat’s branch has a new commit. Work on the branch as it is now.',
  pull_request:
    'Started by this workflow’s trigger: this chat’s pull request was opened or has a new head. Work on its branch as it is now.',
  chat_started:
    'Started by this workflow’s trigger: this chat has just started. Work from the chat as it is now.',
};

export interface TriggerDeps extends StartRunDeps {
  now(): Date;
}

async function decide(deps: TriggerDeps, claim: ClaimedTrigger): Promise<TriggerOutcome | 'wait'> {
  const { db, workspaceId } = deps;
  const repeated = await existingRun(deps, claim.messageId);
  if (repeated) return { state: 'started', workflowRunId: repeated.id };
  const stored = await getTriggers(db, workspaceId, claim.workflowId);
  const file = await deps.store.read(claim.workflowId);
  if (!stored || !file) {
    return { state: 'not_started', reason: 'problem', detail: 'The workflow no longer exists.' };
  }
  const [problem] = workflowProblems(file.workflow.steps, await workspaceSparkIds(db, workspaceId));
  if (problem) return { state: 'not_started', reason: 'problem', detail: problem.text };
  if (!(await openScheduleChat(db, workspaceId, claim.conversationId))) {
    return { state: 'not_started', reason: 'chat_gone', detail: null };
  }
  if (await workflowRunningInChat(db, claim.workflowId, claim.conversationId)) return 'wait';
  if (claim.kind === 'chat_started' && (await chatTurnActive(db, claim.conversationId))) {
    return 'wait';
  }
  const code = await chatCode(db, claim.conversationId);
  const hash = code ? await diffHash(code) : null;
  const last = await lastTriggeredHash(db, workspaceId, claim.workflowId, claim.conversationId);
  if (hash !== null && hash === last) {
    return { state: 'skipped', reason: 'unchanged', detail: null };
  }
  const run = await startWorkflowRun(deps, {
    kind: 'run',
    workflowId: claim.workflowId,
    messageId: claim.messageId,
    source: 'trigger',
    conversationId: claim.conversationId,
    projectId: null,
    message: TRIGGER_MESSAGES[claim.kind],
    trigger: { kind: claim.kind, diffHash: hash },
    edits: stored.triggers.edits,
  });
  return { state: 'started', workflowRunId: run.id };
}

async function launch(deps: TriggerDeps, claim: ClaimedTrigger, now: Date): Promise<void> {
  try {
    const outcome = await decide(deps, claim);
    if (outcome === 'wait') await releaseClaim(deps.db, claim.id, now);
    else await settleTrigger(deps.db, claim.id, outcome);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await settleTrigger(deps.db, claim.id, { state: 'not_started', reason: 'error', detail });
  }
}

export async function checkTriggers(deps: TriggerDeps): Promise<void> {
  const now = deps.now();
  const { db, workspaceId } = deps;
  if (await sparkPaused(db, workspaceId)) return;
  await scanPullRequests(db, workspaceId, now);
  const claims = [
    ...(await reclaimStrandedTriggers(db, workspaceId, now, STRANDED_TRIGGER_MS)),
    ...(await claimDueTriggers(db, workspaceId, now)),
  ];
  for (const claim of claims) await launch(deps, claim, now);
}
