import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { insertPlanDocument } from '../persistence/plan-documents.ts';
import { autoContinueSeconds } from '../persistence/setup.ts';
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

const LEVEL_NAME: Readonly<Record<InvolvementLevel, string>> = {
  'hands-off': 'Automatic',
  'full-auto': 'Full auto',
};

const HELD_WAIT = 'Build it, edit it, or stop.';

function waitLine(level: InvolvementLevel, seconds: number | null): string {
  if (seconds !== null)
    return `${LEVEL_NAME[level]} builds it in ${seconds} s unless you edit or stop it.`;
  if (level !== 'full-auto') return 'Auto-continue is off: build it, edit it, or stop.';
  return `Auto-continue is off, so Full auto waits ${FULL_AUTO_PLAN_SECONDS} s, then builds it unless you edit or stop it.`;
}

function fallbackSeconds(level: InvolvementLevel): number | null {
  return level === 'full-auto' ? FULL_AUTO_PLAN_SECONDS : null;
}

function planCard(version: number, wait: string, autoOption: string | null): CheckpointCard {
  const reason = `Saved as plan v${version}; nothing was changed yet. ${wait}`;
  return {
    kind: 'plan',
    title: PLAN_QUESTION,
    payload: checkpointPayloadSchema.parse({
      kind: 'plan',
      question: PLAN_QUESTION,
      reason,
      autoOption,
    }),
    options: [
      { optionId: CHECKPOINT_OPTION.makeChange, name: 'Build this plan', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.editPlan, name: 'Edit plan', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

export function planFirstCard(
  version: number,
  level: InvolvementLevel,
  seconds: number | null,
): CheckpointCard {
  return planCard(version, waitLine(level, seconds), CHECKPOINT_OPTION.makeChange);
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

function cardFor(s: Session, version: number, seconds: number | null): CheckpointCard {
  if (!destructiveWork(s)) return planFirstCard(version, s.input.level, seconds);
  return heldCard(planCard(version, HELD_WAIT, null));
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
  const seconds = await autoContinueSeconds(s.deps.db, s.input.workspaceId);
  const card = withEstimate(
    cardFor(s, plan.version, seconds),
    (await ensureEstimate(s))?.text ?? null,
  );
  const answer = await askCard(s, card, held ? null : fallbackSeconds(s.input.level));
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
