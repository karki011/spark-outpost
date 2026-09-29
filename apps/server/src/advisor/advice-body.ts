import {
  adviceDifferences,
  type AdviceBody,
  type AdviceUsage,
  type IntakeAnswer,
  type IntakeCall,
  type JevIntake,
} from '@spark-outpost/contracts';
import type { IntakeRequest } from './advice.ts';
import { gate } from './gate.ts';
import type { IntakeQuestions, SystemOneResponse } from './intake-questions.ts';
import { notAskedReasons } from './not-asked.ts';
import { POLICY_VERSION } from './policy.ts';

export type JevOutcome =
  | { status: 'not_connected' }
  | {
      status: 'failed' | 'timed_out';
      error: string;
      model: string;
      asked: IntakeQuestions | null;
      latencyMs: number | null;
    }
  | {
      status: 'answered';
      model: string;
      asked: IntakeQuestions;
      response: SystemOneResponse;
      intake: JevIntake;
      latencyMs: number;
      usage: AdviceUsage;
    };

export interface IntakeDecided {
  rules: IntakeAnswer;
  calls: Record<string, IntakeCall>;
}

function applied(calls: Record<string, IntakeCall>): AdviceBody['wouldApply'] {
  const entries = Object.values(calls);
  if (entries.some((entry) => entry.source === 'jev')) return 'jev';
  if (entries.some((entry) => entry.gate?.decision === 'ask')) return 'ask';
  return 'rules';
}

export function adviceBody(
  request: IntakeRequest,
  outcome: JevOutcome,
  decided: IntakeDecided,
): AdviceBody {
  const base: AdviceBody = {
    purpose: 'intake',
    policyVersion: POLICY_VERSION,
    calls: decided.calls,
    routing: request.routing,
    rules: decided.rules,
    jev: null,
    jevStatus: outcome.status,
    jevError: null,
    jevModel: null,
    gate: null,
    routeGate: null,
    wouldApply: 'rules',
    differences: [],
    latencyMs: null,
    usage: null,
    state: null,
    questions: null,
    answers: null,
  };
  if (outcome.status === 'not_connected') return base;
  const sent = {
    jevModel: outcome.model,
    latencyMs: outcome.latencyMs,
    state: outcome.asked?.state ?? null,
    questions: outcome.asked?.questions ?? null,
    ...(outcome.asked ? { notAsked: notAskedReasons(request, outcome.asked) } : {}),
  };
  if (outcome.status !== 'answered') return { ...base, ...sent, jevError: outcome.error };
  const route = outcome.intake.routeConfidence;
  return {
    ...base,
    ...sent,
    jevModel: outcome.response.model,
    jev: outcome.intake,
    gate: decided.calls.question?.gate ?? null,
    routeGate: route === null ? null : gate(route, 'tier', request.level, decided.rules.risk),
    wouldApply: applied(decided.calls),
    differences: adviceDifferences(decided.rules, outcome.intake),
    usage: outcome.usage,
    answers: outcome.response.answers,
  };
}
