import type {
  InvolvementLevel,
  IntakeAnswer,
  IntakeCall,
  JevIntake,
  Risk,
  RunMode,
} from '@spark-outpost/contracts';
import { noulGate } from '../advisor/gate.ts';
import type { ActingQuestion } from '../advisor/policy.ts';
import { vagueByRule, vagueHandling } from './clarify.ts';
import {
  asksForReview,
  destructiveByRule,
  followUpByRule,
  planOnlyByRule,
  questionByRule,
  reviewsExistingByRule,
  trivialByRule,
} from './risk-rules.ts';
import type { StartMode } from './transitions.ts';

export interface CurrentTask {
  taskId: string;
  previousRequest: string;
  summary: string;
  lastReplyAt: Date | null;
}

export interface IntakeFacts {
  request: string;
  mode: RunMode;
  level: InvolvementLevel;
  firstMessage: boolean;
  namedFiles: number;
  currentTask: CurrentTask | null;
  now?: Date;
}

export interface IntakeDecisions {
  start: StartMode;
  assume: boolean;
  review: boolean;
  destructive: boolean;
  trivial: boolean;
  continues: boolean | null;
  risk: Risk;
  calls: Record<string, IntakeCall>;
}

type Noul = 'question' | 'planOnly' | 'vague' | 'review' | 'destructive' | 'continuesTask';

function call(
  jev: JevIntake | null,
  field: Noul,
  question: ActingQuestion,
  rule: boolean,
  facts: IntakeFacts,
  risk: Risk,
): IntakeCall & { asks: boolean } {
  const noul = jev?.[field] ?? null;
  const gated = noulGate(noul, question, facts.level, risk);
  const decided = gated.value;
  return {
    jev: noul,
    rule,
    value: decided ?? rule,
    source: decided === null ? 'rules' : 'jev',
    gate: gated.gate,
    asks: gated.gate?.decision === 'ask',
  };
}

function plain(entry: IntakeCall & { asks: boolean }): IntakeCall {
  return {
    jev: entry.jev,
    rule: entry.rule,
    value: entry.value,
    source: entry.source,
    gate: entry.gate,
  };
}

function flaggedByRuleOrJev(entry: IntakeCall): boolean {
  return entry.rule === true || (entry.source === 'jev' && entry.value);
}

interface StartSignals {
  planOnly: boolean;
  reviewOnly: boolean;
  answers: boolean;
  choose: boolean;
  interpret: boolean;
}

function startMode(signals: StartSignals): StartMode {
  if (signals.planOnly) return 'plan';
  if (signals.reviewOnly) return 'review';
  if (signals.answers) return 'answer';
  if (signals.choose) return 'choose';
  if (signals.interpret) return 'interpret';
  return 'build';
}

export function decideIntake(jev: JevIntake | null, facts: IntakeFacts): IntakeDecisions {
  const doing = facts.mode === 'do';
  const ruleRisk: Risk = doing ? 'edits' : 'read-only';
  if (!doing) {
    return {
      start: 'answer',
      assume: false,
      review: false,
      destructive: false,
      trivial: false,
      continues: null,
      risk: 'read-only',
      calls: {},
    };
  }
  const destructiveCall = call(
    jev,
    'destructive',
    'destructive',
    destructiveByRule(facts.request),
    facts,
    ruleRisk,
  );
  const destructive = flaggedByRuleOrJev(destructiveCall);
  const risk: Risk = destructive ? 'destructive' : 'edits';
  const question = call(jev, 'question', 'question', questionByRule(facts.request), facts, risk);
  const review = call(jev, 'review', 'review', asksForReview(facts.request), facts, risk);
  const planCall = call(jev, 'planOnly', 'plan_only', planOnlyByRule(facts.request), facts, risk);
  const planOnly = flaggedByRuleOrJev(planCall);
  const calls: Record<string, IntakeCall> = {
    question: plain(question),
    ...(planOnly ? { plan_only: plain({ ...planCall, value: planOnly }) } : {}),
    review: plain(review),
    destructive: plain({ ...destructiveCall, value: destructive }),
  };
  let vague = false;
  if (facts.firstMessage) {
    const vagueCall = call(
      jev,
      'vague',
      'vague',
      vagueByRule(facts.request, facts.namedFiles),
      facts,
      risk,
    );
    vague = vagueCall.value;
    calls.vague = plain(vagueCall);
  }
  let continues: boolean | null = null;
  if (facts.currentTask) {
    const rule = followUpByRule(facts.request, facts.currentTask.lastReplyAt, facts.now);
    const continuesCall = call(jev, 'continuesTask', 'continues_task', rule, facts, risk);
    continues = continuesCall.value;
    calls.continues_task = plain(continuesCall);
  }
  const answers = question.source === 'jev' ? question.value : question.rule === true;
  const existing = reviewsExistingByRule(facts.request);
  const reviewOnly = existing || (review.value && answers);
  const start = startMode({
    planOnly,
    reviewOnly,
    answers,
    choose: question.asks && !destructive,
    interpret: vague && vagueHandling(facts.level) === 'ask',
  });
  return {
    start,
    assume: vague && start === 'build' && vagueHandling(facts.level) === 'assume',
    review: review.value || start === 'review',
    destructive,
    trivial: !destructive && trivialByRule(facts.request),
    continues,
    risk,
    calls,
  };
}

export function readOnlyStart(start: StartMode): boolean {
  return start === 'answer' || start === 'plan' || start === 'review';
}

export function rulesAnswer(
  base: IntakeAnswer,
  decisions: IntakeDecisions,
  pick: Pick<IntakeAnswer, 'model' | 'modelLabel' | 'effort'>,
): IntakeAnswer {
  return {
    ...base,
    risk: decisions.risk,
    depth: readOnlyStart(decisions.start) ? 'direct' : 'execute',
    ...pick,
  };
}
