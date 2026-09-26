import {
  adviceDifferences,
  type AdviceBody,
  type AdviceUsage,
  type GateDecision,
  type JevIntake,
} from '@spark-outpost/contracts';
import { ruleAdvisor, type IntakeRequest } from './advice.ts';
import { gate } from './gate.ts';
import type { IntakeQuestions, SystemOneResponse } from './intake-questions.ts';

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

const APPLIED: Record<GateDecision, AdviceBody['wouldApply']> = {
  act: 'jev',
  ask: 'ask',
  fallback: 'rules',
};

export function adviceBody(request: IntakeRequest, outcome: JevOutcome): AdviceBody {
  const rules = ruleAdvisor(request);
  const base: AdviceBody = {
    purpose: 'intake',
    routing: request.routing,
    rules,
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
  };
  if (outcome.status !== 'answered') return { ...base, ...sent, jevError: outcome.error };
  const risk = request.mode === 'do' ? outcome.intake.risk : 'read-only';
  const decision = gate(outcome.intake, risk, request.level);
  const route = outcome.intake.routeConfidence;
  return {
    ...base,
    ...sent,
    jevModel: outcome.response.model,
    jev: outcome.intake,
    gate: decision,
    routeGate: route === null ? null : gate({ confidence: route }, risk, request.level),
    wouldApply: APPLIED[decision.decision],
    differences: adviceDifferences(rules, outcome.intake),
    usage: outcome.usage,
    answers: outcome.response.answers,
  };
}
