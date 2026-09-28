import { CHECKPOINT_OPTION, type AgentPick } from '@spark-outpost/contracts';
import { runChanges } from '../projects/run-changes.ts';
import { runEvents } from '../workflow/run-events.ts';
import { extendLimits, usedAndAllowed } from './budget.ts';
import { budgetUsage } from './budget-check.ts';
import {
  acceptCard,
  answerOrBuildCard,
  askCard,
  budgetCard,
  CheckpointTimeout,
  clarifiedRequest,
  retryCard,
  stuckCard,
  verifyCard,
  type CheckpointCard,
} from './checkpoint.ts';
import { autoContinueOption } from './checkpoint-policy.ts';
import { sessionReviewLine } from './critic-fix.ts';
import { fixOptionLabel } from './review-loop.ts';
import {
  assumedRequest,
  chosenInterpretation,
  interpretationCard,
  interpretations,
} from './clarify.ts';
import { escalateBuilder } from './routing.ts';
import { save, type Session } from './session.ts';
import type { FlowAction, FlowEvent } from './transitions.ts';

type Ask = Extract<FlowAction, { type: 'ask' }>;

function builderPick(s: Session): AgentPick | null {
  return s.routes.get('builder')?.pick ?? null;
}

async function cardFor(s: Session, action: Ask): Promise<CheckpointCard> {
  if (action.kind === 'clarify') return answerOrBuildCard(action.reason);
  if (action.kind === 'retry' || action.kind === 'verify') {
    const previous = s.routes.get('builder');
    const to = previous ? escalateBuilder(s.route, previous).pick : null;
    const card = action.kind === 'retry' ? retryCard : verifyCard;
    return card(builderPick(s), to, action.reason);
  }
  if (action.kind === 'stuck') {
    const name = s.results.findLast((result) => result.role === 'builder')?.name ?? 'The Builder';
    return stuckCard(name, action.reason);
  }
  if (action.kind === 'accept') {
    const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
    const line = sessionReviewLine(s);
    const reason = line ? `${action.reason} ${line}` : action.reason;
    return acceptCard(changes.files, reason, fixOptionLabel(s.flow.review));
  }
  const usage = await budgetUsage(s);
  const limit = s.budgetHit ?? 'time';
  const { used, allowed } = usedAndAllowed(limit, usage, s.limits);
  return budgetCard(limit, used, allowed, action.reason);
}

function withAutoOption(action: Ask, card: CheckpointCard): CheckpointCard {
  const autoOption = autoContinueOption(action.kind, action.interpret ?? false);
  return autoOption ? { ...card, payload: { ...card.payload, autoOption } } : card;
}

export function intakeResponse(s: Session) {
  return s.intake.outcome.status === 'answered' ? s.intake.outcome.response : null;
}

export async function assume(s: Session, interpretation: string): Promise<void> {
  s.assumption = interpretation;
  s.input = {
    ...s.input,
    userRequest: assumedRequest(s.input.userRequest, interpretation),
    prompt: assumedRequest(s.input.prompt, interpretation),
  };
  const note = `Assumed: ${interpretation}`;
  await s.append(runEvents.stepStarted(note));
  await s.append(runEvents.stepFinished(note));
}

function clarify(s: Session, answer: string): void {
  s.input = {
    ...s.input,
    userRequest: clarifiedRequest(s.input.userRequest, answer),
    prompt: clarifiedRequest(s.input.prompt, answer),
  };
}

async function askInterpretation(s: Session, action: Ask): Promise<FlowEvent> {
  const card = interpretationCard(interpretations(intakeResponse(s)), action.reason);
  const answer = await askCard(s, withAutoOption(action, card));
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  const picked = chosenInterpretation(card, answer.optionId, answer.note);
  if (picked.type === 'stopped') return { type: 'clarified', answer: null };
  if (picked.type === 'assumed') await assume(s, picked.text);
  else clarify(s, picked.text);
  return { type: 'clarified', answer: false };
}

export async function ask(s: Session, action: Ask): Promise<FlowEvent> {
  if (action.interpret) return askInterpretation(s, action);
  const card = withAutoOption(action, await cardFor(s, action));
  const answer = await askCard(s, card);
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (action.answerOrBuild) {
    if (answer.optionId === CHECKPOINT_OPTION.stop) return { type: 'clarified', answer: null };
    return { type: 'clarified', answer: answer.optionId === CHECKPOINT_OPTION.justAnswer };
  }
  if (action.kind === 'budget' && answer.optionId === CHECKPOINT_OPTION.continueBudget) {
    s.limits = extendLimits(s.limits, await budgetUsage(s), s.baseLimits);
    s.budgetHit = null;
    await save(s, {
      activeLimitMs: s.limits.activeLimitMs,
      toolCallLimit: s.limits.toolCallLimit,
      costCapUsd: s.limits.costCapUsd,
      exceeded: null,
    });
  }
  return { type: 'answered', kind: action.kind, optionId: answer.optionId, note: answer.note };
}
