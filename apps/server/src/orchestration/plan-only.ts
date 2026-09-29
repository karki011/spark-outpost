import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type PlanDocument,
} from '@spark-outpost/contracts';
import {
  approvePlanDocument,
  insertPlanDocument,
  proposedPlanFromRun,
  rejectPlanDocument,
} from '../persistence/plan-documents.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { announcePlan, approvalCommit, planSaveFailed } from '../workflow/plan-recorder.ts';
import { checkBudget } from './budget-check.ts';
import { askCard, CheckpointTimeout, type CheckpointCard } from './checkpoint.ts';
import { runMember } from './members.ts';
import { publish, save, type Session } from './session.ts';
import type { FlowEvent } from './transitions.ts';

const PLAN_ONLY_NOTE =
  'The user asked for a plan only, not changes yet. Read the code you need, then reply with a step-by-step implementation plan: numbered steps that name the files to add or change, the tests to add, and any open questions. Do not change any files.';

const PLAN_QUESTION = 'Approve the plan?';

function planOnlyPrompt(prompt: string, note: string | null): string {
  const base = `${prompt}\n\n${PLAN_ONLY_NOTE}`;
  if (!note) return base;
  return `${base}\n\nThe user asked for these changes to your previous plan:\n\n${note}\n\nReply with the whole revised plan.`;
}

export function planCard(version: number): CheckpointCard {
  const reason = `Saved as proposed plan v${version}; nothing was changed. Approve it to make it the agreed plan that a later build follows.`;
  return {
    kind: 'plan',
    title: PLAN_QUESTION,
    payload: checkpointPayloadSchema.parse({ kind: 'plan', question: PLAN_QUESTION, reason }),
    options: [
      { optionId: CHECKPOINT_OPTION.approvePlan, name: 'Approve plan', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.editPlan, name: 'Revise', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

const originals = new WeakMap<Session, string>();

export async function closeReply(s: Session): Promise<string | null> {
  const message = s.message;
  if (!message) return null;
  await closeMessage(s.append, { messageId: message.id, text: message.text }, true);
  s.message = null;
  return message.id;
}

async function propose(s: Session, body: string, messageId: string | null) {
  const captured = await proposedPlanFromRun(s.deps.db, s.lease.runId);
  const plan =
    captured ??
    (await insertPlanDocument(s.deps.db, {
      conversationId: s.input.identity.threadId,
      taskId: s.taskId,
      source: 'chat',
      body,
      sourceRunId: s.lease.runId,
      sourceMessageId: messageId,
    }));
  if (!captured) await announcePlan(s.append, plan);
  return plan;
}

async function settle(s: Session, plan: PlanDocument, optionId: string): Promise<void> {
  const settled =
    optionId === CHECKPOINT_OPTION.approvePlan || optionId === CHECKPOINT_OPTION.makeChange
      ? await approvePlanDocument(s.deps.db, plan.id, {
          by: 'user',
          option: optionId,
          runId: s.lease.runId,
          commit: await approvalCommit(s.input.projectRoots[0] ?? null).catch(() => null),
        })
      : await rejectPlanDocument(s.deps.db, plan.id, null);
  await announcePlan(s.append, settled);
}

export async function settleQuietly(
  s: Session,
  plan: PlanDocument,
  optionId: string,
): Promise<void> {
  try {
    await settle(s, plan, optionId);
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    await planSaveFailed(s.append, error);
  }
}

export type Drafted = { plan: PlanDocument } | { event: FlowEvent };

export function originalPrompt(s: Session): string {
  const original = originals.get(s) ?? s.input.prompt;
  originals.set(s, original);
  return original;
}

export async function draftPlan(s: Session, prompt: string, note: string | null): Promise<Drafted> {
  const hit = await checkBudget(s);
  if (hit) return { event: { type: 'budget_exceeded', limit: hit, unstarted: true } };
  s.input = { ...s.input, prompt };
  const { result } = await runMember(s, {
    role: 'scout',
    reason: note ? 'retry' : 'first',
    escalate: false,
    note,
  });
  if (result.outcome === 'lease_lost') throw new LeaseLostError(s.lease);
  await publish(s);
  if (s.budgetHit && s.control.reason() === null) {
    return { event: { type: 'budget_exceeded', limit: s.budgetHit } };
  }
  const body = result.text.trim();
  if (result.outcome !== 'succeeded' || !body) {
    return {
      event: {
        type: 'agent_done',
        role: 'scout',
        outcome: result.outcome === 'succeeded' ? 'failed' : result.outcome,
        error: result.error ?? (body ? null : 'The planner replied without a plan.'),
      },
    };
  }
  const messageId = await closeReply(s);
  try {
    return { plan: await propose(s, body, messageId) };
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    await planSaveFailed(s.append, error);
    return { event: { type: 'agent_done', role: 'scout', outcome: 'succeeded' } };
  }
}

export async function writePlanOnly(s: Session, note: string | null): Promise<FlowEvent> {
  const drafted = await draftPlan(s, planOnlyPrompt(originalPrompt(s), note), note);
  if ('event' in drafted) return drafted.event;
  const { plan } = drafted;
  s.flow = { ...s.flow, phase: 'waiting', waitingFor: 'plan' };
  await save(s);
  const answer = await askCard(s, planCard(plan.version));
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (answer.type === 'stopped') {
    await settleQuietly(s, plan, CHECKPOINT_OPTION.stop);
    return { type: 'stopped' };
  }
  await settleQuietly(s, plan, answer.optionId);
  return { type: 'answered', kind: 'plan', optionId: answer.optionId, note: answer.note };
}
