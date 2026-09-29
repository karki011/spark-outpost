import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { autoContinueSeconds } from '../persistence/setup.ts';
import { askCard, CheckpointTimeout, type CheckpointCard } from './checkpoint.ts';
import { draftPlan, originalPrompt, settleQuietly } from './plan-only.ts';
import { save, type Session } from './session.ts';
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

function waitLine(level: InvolvementLevel, seconds: number | null): string {
  if (level !== 'full-auto') return 'Build it, edit it, or stop.';
  if (seconds !== null) return `Full auto builds it in ${seconds} s unless you edit or stop it.`;
  return `Auto-continue is off, so Full auto waits ${FULL_AUTO_PLAN_SECONDS} s, then builds it unless you edit or stop it.`;
}

export function planFirstCard(
  version: number,
  level: InvolvementLevel,
  seconds: number | null,
): CheckpointCard {
  const reason = `Saved as plan v${version}; nothing was changed yet. ${waitLine(level, seconds)}`;
  const autoOption = level === 'full-auto' ? CHECKPOINT_OPTION.makeChange : null;
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

export function planPrNote(body: string): string {
  const capped = body.length > PR_PLAN_LIMIT ? `${body.slice(0, PR_PLAN_LIMIT)}…` : body;
  return `Plan it followed:\n\n${capped}`;
}

export async function writePlanFirst(s: Session, note: string | null): Promise<FlowEvent> {
  const original = originalPrompt(s);
  const drafted = await draftPlan(s, planFirstPrompt(original, note), note);
  s.input = { ...s.input, prompt: original };
  if ('event' in drafted) return drafted.event;
  const { plan } = drafted;
  s.flow = { ...s.flow, phase: 'waiting', waitingFor: 'plan' };
  await save(s);
  const seconds = await autoContinueSeconds(s.deps.db, s.input.workspaceId);
  const card = planFirstCard(plan.version, s.input.level, seconds);
  const answer = await askCard(s, card, FULL_AUTO_PLAN_SECONDS);
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
