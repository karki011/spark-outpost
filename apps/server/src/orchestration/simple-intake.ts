import { CHECKPOINT_OPTION, type CheckBody } from '@spark-outpost/contracts';
import { NEED_ACT_AT } from '../advisor/need-question.ts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { changeFailureText } from './check-results.ts';
import type { ClarifiedStart, FlowAction, FlowEvent, StartMode } from './flow-types.ts';
import type { IntakeDecisions } from './intake.ts';
import { runMember, type Place } from './members.ts';
import { publish, type MemberResult, type Session } from './session.ts';

export type Need = 'question' | 'small_change' | 'build' | 'needs_you' | 'review';

export const NEEDS_YOU_NOTE = [
  'The request is too unclear to act on yet. Do not change any files.',
  'Read the code the request most likely refers to, then ask the user the 1 to 3 short, specific questions that would settle what they want, each with your best guess.',
  'Reply with the questions as a short numbered list and stop. The user answers in their next message.',
].join('\n');

export const UPGRADED_NOTE =
  'This started as a small change. Its checks failed twice, so it is now handled as a build.';

const NEEDS_YOU_PREFIX = 'Needs you';

function startWithoutPlans<T extends StartMode | ClarifiedStart>(start: T): T | 'answer' | 'build' {
  if (start === 'plan') return 'answer';
  return start === 'plan_first' ? 'build' : start;
}

export type JevNeed = { value: Exclude<Need, 'review'>; confidence: number } | null | undefined;

export interface NeedRead {
  need: Need;
  source: 'jev' | 'rules';
  confidence: number | null;
}

function needByRule(decisions: Pick<IntakeDecisions, 'start' | 'trivial' | 'continues'>): Need {
  if (decisions.start === 'ask_agent') return 'needs_you';
  if (decisions.start === 'answer' || decisions.start === 'plan') return 'question';
  if (decisions.start === 'review') return 'review';
  return decisions.trivial || decisions.continues === true ? 'small_change' : 'build';
}

export function readNeed(
  decisions: Pick<IntakeDecisions, 'start' | 'trivial' | 'continues'>,
  jev: JevNeed = null,
): NeedRead {
  const byRule = needByRule(decisions);
  const confidence = jev?.confidence ?? null;
  if (!jev || jev.confidence < NEED_ACT_AT || byRule === 'review') {
    return { need: byRule, source: 'rules', confidence };
  }
  return { need: jev.value, source: 'jev', confidence };
}

const START_FOR: Record<Exclude<Need, 'review'>, StartMode> = {
  question: 'answer',
  needs_you: 'ask_agent',
  small_change: 'build',
  build: 'build',
};

export function simpleDecisions(decisions: IntakeDecisions, read: NeedRead): IntakeDecisions {
  const start = read.need === 'review' ? decisions.start : START_FOR[read.need];
  return {
    ...decisions,
    start: startWithoutPlans(start),
    then: startWithoutPlans(decisions.then),
  };
}

export async function recordNeed(s: Session, read: NeedRead, why: string): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'route',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: { need: read.need, source: read.source, confidence: read.confidence, summary: why },
  }).catch((error: unknown) => console.error('Could not record the intake need', error));
}

async function needsYouTurn(s: Session): Promise<FlowEvent> {
  const request = s.input.prompt;
  s.input = { ...s.input, prompt: `${request}\n\n${NEEDS_YOU_NOTE}` };
  const { result } = await runMember(s, {
    role: 'scout',
    reason: 'first',
    escalate: false,
    note: null,
  });
  s.input = { ...s.input, prompt: request };
  if (result.outcome === 'lease_lost') throw new LeaseLostError(s.lease);
  await publish(s);
  return { type: 'agent_done', role: 'scout', outcome: result.outcome, error: result.error };
}

export type SimpleStep = { event: FlowEvent } | { action: FlowAction } | null;

export async function simpleStep(s: Session, action: FlowAction): Promise<SimpleStep> {
  if (action.type === 'ask_agent') return { event: await needsYouTurn(s) };
  if (action.type === 'plan_first') {
    return {
      event: {
        type: 'answered',
        kind: 'plan',
        optionId: CHECKPOINT_OPTION.makeChange,
        note: action.note,
      },
    };
  }
  if (action.type === 'plan') {
    return {
      action: { type: 'spawn', role: 'scout', reason: 'first', escalate: false, note: null },
    };
  }
  if (action.type === 'ask' && action.kind !== 'accept') {
    return {
      action: {
        type: 'finish',
        status: 'succeeded',
        reason: null,
        incomplete: `${NEEDS_YOU_PREFIX}: ${action.reason}`,
      },
    };
  }
  return null;
}

export async function upgradeToBuild(
  s: Session,
  checks: CheckBody,
  place: Place | null,
  retried: boolean,
): Promise<MemberResult | null> {
  if (s.need !== 'small_change' || checks.status !== 'failed' || !retried) return null;
  s.need = 'build';
  await recordNeed(s, { need: 'build', source: 'rules', confidence: null }, UPGRADED_NOTE);
  s.upgraded = true;
  const outcome = await runMember(
    s,
    { role: 'builder', reason: 'retry', escalate: true, note: UPGRADED_NOTE },
    place,
    { checkFailures: changeFailureText(checks) },
  );
  return outcome.result;
}
