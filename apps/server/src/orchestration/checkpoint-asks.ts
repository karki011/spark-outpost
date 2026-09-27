import { CHECKPOINT_OPTION, type AgentPick } from '@spark-outpost/contracts';
import { spentUsd, waitedMs } from '../persistence/orchestrations.ts';
import { runChanges } from '../projects/run-changes.ts';
import { runEvents } from '../workflow/run-events.ts';
import { activeTime, extendLimits, usedAndAllowed } from './budget.ts';
import {
  acceptCard,
  agentQuestion,
  askCard,
  budgetCard,
  CheckpointTimeout,
  clarifiedRequest,
  clarifyCard,
  clarifyDepths,
  depthFromClarify,
  needsInputCard,
  planCard,
  retryCard,
  type CheckpointCard,
} from './checkpoint.ts';
import { autoContinueOption } from './checkpoint-policy.ts';
import {
  assumedRequest,
  chosenInterpretation,
  interpretationCard,
  interpretations,
} from './clarify.ts';
import { ruleDepth } from './depth.ts';
import { escalate, ruleCriticPick } from './routing.ts';
import { routeKey, save, type Session } from './session.ts';
import type { FlowAction, FlowEvent } from './transitions.ts';

function lastPick(s: Session): AgentPick | null {
  const builder = s.routes.get(routeKey('builder', s.flow.stepIndex));
  return builder?.pick ?? null;
}

async function cardFor(
  s: Session,
  action: Extract<FlowAction, { type: 'ask' }>,
): Promise<CheckpointCard> {
  if (action.kind === 'clarify') {
    const response = s.intake.outcome.status === 'answered' ? s.intake.outcome.response : null;
    return clarifyCard(clarifyDepths(response, s.flow.depth), action.reason);
  }
  if (action.kind === 'plan') return planCard(s.plan, s.planVersion, action.reason);
  if (action.kind === 'needs_input') {
    const last = s.results.at(-1);
    return needsInputCard(last?.name ?? 'The agent', action.blocked ?? false, last?.text ?? '');
  }
  if (action.kind === 'retry') {
    const previous = s.routes.get(routeKey('builder', s.flow.stepIndex));
    const to =
      action.suggestion === 'review'
        ? ruleCriticPick(s.route)
        : previous
          ? escalate(s.route, previous).pick
          : null;
    return retryCard(action.suggestion, lastPick(s), to, action.reason);
  }
  if (action.kind === 'accept') {
    const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
    return acceptCard(changes.files, action.reason);
  }
  const usage = await budgetUsage(s);
  const limit = s.budgetHit ?? 'time';
  const { used, allowed } = usedAndAllowed(limit, usage, s.limits);
  return budgetCard(limit, used, allowed, action.reason);
}

export async function budgetUsage(s: Session) {
  const waited = await waitedMs(s.deps.db, s.lease.runId);
  return {
    activeMs: activeTime(Date.now() - s.startedAt, waited),
    toolCalls: s.toolCalls,
    costUsd: await spentUsd(s.deps.db, s.lease.runId),
  };
}

function withAutoOption(
  s: Session,
  action: Extract<FlowAction, { type: 'ask' }>,
  card: CheckpointCard,
): CheckpointCard {
  const text = action.kind === 'needs_input' ? (s.results.at(-1)?.text ?? '') : '';
  const autoOption = autoContinueOption({
    kind: action.kind,
    fromJev: action.fromJev,
    agentAsked: agentQuestion(text) !== null,
  });
  return { ...card, payload: { ...card.payload, autoOption } };
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

async function askInterpretation(
  s: Session,
  action: Extract<FlowAction, { type: 'ask' }>,
): Promise<FlowEvent> {
  const card = interpretationCard(interpretations(intakeResponse(s)), action.reason);
  const answer = await askCard(s, withAutoOption(s, action, card));
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  const picked = chosenInterpretation(card, answer.optionId, answer.note);
  if (picked.type === 'stopped') return { type: 'clarified', depth: null };
  if (picked.type === 'assumed') await assume(s, picked.text);
  else clarify(s, picked.text);
  return { type: 'clarified', depth: s.flow.depth };
}

export async function ask(
  s: Session,
  action: Extract<FlowAction, { type: 'ask' }>,
): Promise<FlowEvent> {
  if (action.interpret) return askInterpretation(s, action);
  const card = withAutoOption(s, action, await cardFor(s, action));
  const answer = await askCard(s, card);
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (action.kind === 'clarify') {
    const rules = ruleDepth(s.input.mode ?? 'chat', s.flow.risk);
    const depth = depthFromClarify(card, answer.optionId, rules);
    if (answer.optionId === CHECKPOINT_OPTION.answer && answer.note) clarify(s, answer.note);
    if (depth) await save(s, { depthSource: depthSourceOf(answer.optionId) });
    return { type: 'clarified', depth };
  }
  if (action.kind === 'budget' && answer.optionId === 'continue') {
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

function depthSourceOf(optionId: string): 'rules' | 'user' {
  const byRules =
    optionId === CHECKPOINT_OPTION.clarifyRules || optionId === CHECKPOINT_OPTION.answer;
  return byRules ? 'rules' : 'user';
}

function clarify(s: Session, answer: string): void {
  const request = clarifiedRequest(s.input.userRequest, answer);
  s.input = { ...s.input, userRequest: request, prompt: clarifiedRequest(s.input.prompt, answer) };
}
