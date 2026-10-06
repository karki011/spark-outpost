import { CHECKPOINT_OPTION, checkpointPayloadSchema } from '@spark-outpost/contracts';
import { insertPlanDocument } from '../persistence/plan-documents.ts';
import {
  announcePlan,
  approvalCommit,
  planNote,
  planSaveFailed,
} from '../workflow/plan-recorder.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { specByRule } from './builder-complexity.ts';
import { askCard, CheckpointTimeout, type CheckpointCard } from './checkpoint.ts';
import { destructiveWork, heldCard } from './checkpoint-asks.ts';
import { draftPlan, originalPrompt, settleQuietly } from './plan-only.ts';
import { save, type Session } from './session.ts';
import { ensureEstimate } from '../laws/estimate-history.ts';
import type { FlowEvent } from './transitions.ts';

export const FULL_AUTO_PLAN_SECONDS = 30;
const PLAN_QUESTION = 'Build this plan?';
const PR_PLAN_LIMIT = 4_000;

const PLAN_FIRST_NOTE =
  'Before anything is built, write the plan. Read the code you need, then reply with a numbered step-by-step implementation plan that names the files to add or change and the tests to add. Do not change any files yet; the build follows once the plan is agreed.';

export function planFirstPrompt(prompt: string, note: string | null): string {
  const base = `${prompt}\n\n${PLAN_FIRST_NOTE}`;
  if (!note) return base;
  return `${base}\n\nThe user asked for these changes to your previous plan:\n\n${note}\n\nReply with the whole revised plan.`;
}

const PLAN_WAIT = 'Build it, edit it, or stop.';

export function planFirstCard(version: number): CheckpointCard {
  const reason = `Saved as plan v${version}; nothing was changed yet. ${PLAN_WAIT}`;
  return {
    kind: 'plan',
    title: PLAN_QUESTION,
    payload: checkpointPayloadSchema.parse({
      kind: 'plan',
      question: PLAN_QUESTION,
      reason,
      autoOption: null,
    }),
    options: [
      { optionId: CHECKPOINT_OPTION.makeChange, name: 'Build', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.editPlan, name: 'Edit', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

export function planPrNote(body: string): string {
  const capped = body.length > PR_PLAN_LIMIT ? `${body.slice(0, PR_PLAN_LIMIT)}…` : body;
  return `Plan it followed:\n\n${capped}`;
}

export const SPEC_PLAN_OPTION = 'request_is_plan';

export function specPlanLine(reason: string, version: number | null): string {
  const saved = version === null ? 'building it as written' : `saved as plan v${version}`;
  return `Your request is already a plan (${reason}): ${saved}, no separate plan turn`;
}

async function adoptRequestAsPlan(s: Session, request: string, reason: string): Promise<FlowEvent> {
  let version: number | null = null;
  try {
    const plan = await insertPlanDocument(s.deps.db, {
      conversationId: s.input.identity.threadId,
      taskId: s.taskId,
      source: 'user',
      body: request,
      sourceRunId: s.lease.runId,
      approval: {
        by: 'user',
        option: SPEC_PLAN_OPTION,
        runId: s.lease.runId,
        commit: await approvalCommit(s.input.projectRoots[0] ?? null).catch(() => null),
      },
    });
    version = plan.version;
    await announcePlan(s.append, plan);
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    await planSaveFailed(s.append, error);
  }
  await planNote(s.append, specPlanLine(reason, version));
  s.prNotes = [...(s.prNotes ?? []), planPrNote(request)];
  return { type: 'answered', kind: 'plan', optionId: CHECKPOINT_OPTION.makeChange, note: null };
}

function cardFor(s: Session, version: number): CheckpointCard {
  const card = planFirstCard(version);
  return destructiveWork(s) ? heldCard(card) : card;
}

function withEstimate(card: CheckpointCard, estimate: string | null): CheckpointCard {
  return estimate ? { ...card, payload: { ...card.payload, estimate } } : card;
}

export async function writePlanFirst(s: Session, note: string | null): Promise<FlowEvent> {
  const held = destructiveWork(s);
  const spec = note === null && !held ? specByRule(s.input.userRequest) : null;
  if (spec) return adoptRequestAsPlan(s, s.input.userRequest, spec);
  const original = originalPrompt(s);
  const drafted = await draftPlan(s, planFirstPrompt(original, note), note);
  s.input = { ...s.input, prompt: original };
  if ('event' in drafted) return drafted.event;
  const { plan } = drafted;
  s.flow = { ...s.flow, phase: 'waiting', waitingFor: 'plan' };
  await save(s);
  const card = withEstimate(cardFor(s, plan.version), (await ensureEstimate(s))?.text ?? null);
  const answer = await askCard(s, card);
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (answer.type === 'stopped') {
    await settleQuietly(s, plan, CHECKPOINT_OPTION.stop);
    return { type: 'stopped' };
  }
  await settleQuietly(s, plan, answer.optionId);
  if (answer.optionId === CHECKPOINT_OPTION.makeChange) {
    s.prNotes = [...(s.prNotes ?? []), planPrNote(plan.body)];
  }
  return { type: 'answered', kind: 'plan', optionId: answer.optionId, note: answer.note };
}
