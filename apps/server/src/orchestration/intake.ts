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
  questionByRule,
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

type Noul = 'question' | 'vague' | 'review' | 'destructive' | 'continuesTask';

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
  const destructive =
    destructiveCall.rule === true || (destructiveCall.source === 'jev' && destructiveCall.value);
  const risk: Risk = destructive ? 'destructive' : 'edits';
  const question = call(jev, 'question', 'question', questionByRule(facts.request), facts, risk);
  const review = call(jev, 'review', 'review', asksForReview(facts.request), facts, risk);
  const calls: Record<string, IntakeCall> = {
    question: plain(question),
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
  const start: StartMode = answers
    ? 'answer'
    : question.asks && !destructive
      ? 'choose'
      : vague && vagueHandling(facts.level) === 'ask'
        ? 'interpret'
        : 'build';
  return {
    start,
    assume: vague && start === 'build' && vagueHandling(facts.level) === 'assume',
    review: review.value,
    destructive,
    trivial: !destructive && trivialByRule(facts.request),
    continues,
    risk,
    calls,
  };
}

export function rulesAnswer(
  base: IntakeAnswer,
  decisions: IntakeDecisions,
  pick: Pick<IntakeAnswer, 'model' | 'modelLabel' | 'effort'>,
): IntakeAnswer {
  return {
    ...base,
    risk: decisions.risk,
    depth: decisions.start === 'answer' ? 'direct' : 'execute',
    ...pick,
  };
}
