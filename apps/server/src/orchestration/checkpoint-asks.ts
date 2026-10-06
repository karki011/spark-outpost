import { CHECKPOINT_OPTION, type AgentPick } from '@spark-outpost/contracts';
import { chosenFollowUp, followUpCard } from './follow-up.ts';
import { contextCard } from './missing-context.ts';
import { runChanges } from '../projects/run-changes.ts';
import { runEvents } from '../workflow/run-events.ts';
import {
  acceptCard,
  askCard,
  CheckpointTimeout,
  clarifiedRequest,
  retryCard,
  verifyCard,
  type CheckpointCard,
} from './checkpoint.ts';
import { autoContinueOption, DESTRUCTIVE_WAIT } from './checkpoint-policy.ts';
import { sessionReviewLine } from './critic-fix.ts';
import { fixOptionLabel } from './review-loop.ts';
import {
  assumedRequest,
  chosenInterpretation,
  interpretationCard,
  interpretations,
} from './clarify.ts';
import { changedLines, checkCommands } from './member-prompts.ts';
import { escalatedBuilderPick } from './member-routes.ts';
import type { Session } from './session.ts';
import { lawItems } from '../laws/review.ts';
import type { FlowAction, FlowEvent } from './transitions.ts';

type Ask = Extract<FlowAction, { type: 'ask' }>;

function builderPick(s: Session): AgentPick | null {
  return s.routes.get('builder')?.pick ?? null;
}

async function cardFor(s: Session, action: Ask): Promise<CheckpointCard> {
  if (action.kind === 'clarify') {
    return action.context ? contextCard(action.reason) : followUpCard(action.reason);
  }
  if (action.kind === 'retry' || action.kind === 'verify') {
    const card = action.kind === 'retry' ? retryCard : verifyCard;
    return card(builderPick(s), escalatedBuilderPick(s), action.reason);
  }
  const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
  const line = sessionReviewLine(s);
  const reason = line ? `${action.reason} ${line}` : action.reason;
  const lines = await changedLines(s);
  return acceptCard(changes.files, reason, fixOptionLabel(s.flow.review), lawItems(s), lines);
}

export function destructiveWork(s: Pick<Session, 'facts' | 'risky'>): boolean {
  return s.facts.destructive || s.risky !== null;
}

export function heldCard(card: CheckpointCard): CheckpointCard {
  return { ...card, payload: { ...card.payload, autoOption: null, waitsFor: DESTRUCTIVE_WAIT } };
}

function withAutoOption(s: Session, action: Ask, card: CheckpointCard): CheckpointCard {
  if (action.kind === 'clarify' && destructiveWork(s)) return heldCard(card);
  const autoOption = autoContinueOption(action.kind, action.interpret ?? false);
  return autoOption ? { ...card, payload: { ...card.payload, autoOption } } : card;
}

export function intakeResponse(s: Session) {
  return s.intake.outcome.status === 'answered' ? s.intake.outcome.response : null;
}

export function rewriteRequest(s: Session, rewrite: (text: string) => string): void {
  s.input = {
    ...s.input,
    userRequest: rewrite(s.input.userRequest),
    prompt: rewrite(s.input.prompt),
  };
}

export async function assume(s: Session, interpretation: string): Promise<void> {
  s.assumption = interpretation;
  rewriteRequest(s, (text) => assumedRequest(text, interpretation));
  const note = `Assumed: ${interpretation}`;
  await s.append(runEvents.stepStarted(note));
  await s.append(runEvents.stepFinished(note));
}

async function askInterpretation(s: Session, action: Ask): Promise<FlowEvent> {
  const choices = interpretations(intakeResponse(s), s.input.userRequest, checkCommands(s));
  const card = interpretationCard(choices, action.reason);
  const answer = await askCard(s, withAutoOption(s, action, card));
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  const picked = chosenInterpretation(card, answer.optionId, answer.note);
  if (picked.type === 'stopped') return { type: 'clarified', start: null };
  if (picked.type === 'assumed') await assume(s, picked.text);
  else rewriteRequest(s, (text) => clarifiedRequest(text, picked.text));
  return { type: 'clarified', start: 'build' };
}

async function askFollowUp(s: Session, action: Ask): Promise<FlowEvent> {
  const card = followUpCard(action.reason);
  const answer = await askCard(s, card);
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  const picked = chosenFollowUp(card, answer.optionId, answer.note);
  if (!picked) return { type: 'clarified', start: null };
  const note = picked.note;
  if (note) rewriteRequest(s, (text) => clarifiedRequest(text, note));
  return { type: 'clarified', start: picked.start };
}

export async function ask(s: Session, action: Ask): Promise<FlowEvent> {
  if (action.interpret) return askInterpretation(s, action);
  if (action.followUp) return askFollowUp(s, action);
  const card = withAutoOption(s, action, await cardFor(s, action));
  const answer = await askCard(s, card);
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (action.kind === 'verify' && answer.optionId === CHECKPOINT_OPTION.finishUnverified) {
    s.unverified = true;
  }
  return { type: 'answered', kind: action.kind, optionId: answer.optionId, note: answer.note };
}
