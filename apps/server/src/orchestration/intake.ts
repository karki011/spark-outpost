import type {
  InvolvementLevel,
  IntakeAnswer,
  IntakeCall,
  JevIntake,
  Risk,
  RunMode,
} from '@spark-outpost/contracts';
import { noulGate } from '../advisor/gate.ts';
import { FOLLOW_UP_MINUTES, type ActingQuestion } from '../advisor/policy.ts';
import { vagueByRule } from './clarify.ts';
import { vagueFollowUpByRule } from './follow-up.ts';
import {
  asksForReview,
  buildsByRule,
  destructiveByRule,
  followUpByRule,
  planOnlyByRule,
  questionByRule,
  reviewsExistingByRule,
  trivialByRule,
} from './risk-rules.ts';
import { bigByRule } from './builder-complexity.ts';
import type { ClarifiedStart, StartMode } from './transitions.ts';

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
  previousReply?: string | null;
  change?: boolean;
  hasAgreedPlan?: boolean;
  now?: Date;
}

export interface IntakeDecisions {
  start: StartMode;
  then: ClarifiedStart;
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
): IntakeCall {
  const noul = jev?.[field] ?? null;
  const gated = noulGate(noul, question, facts.level, risk);
  const decided = gated.value;
  return {
    jev: noul,
    rule,
    value: decided ?? rule,
    source: decided === null ? 'rules' : 'jev',
    gate: gated.gate,
  };
}

function flaggedByRuleOrJev(entry: IntakeCall): boolean {
  return entry.rule === true || (entry.source === 'jev' && entry.value);
}

interface StartSignals {
  planOnly: boolean;
  reviewOnly: boolean;
  vague: boolean;
  answers: boolean;
  big: boolean;
}

function startMode(signals: StartSignals): StartMode {
  if (signals.planOnly) return 'plan';
  if (signals.reviewOnly) return 'review';
  if (signals.vague) return 'ask_agent';
  if (signals.answers) return 'answer';
  if (signals.big) return 'plan_first';
  return 'build';
}

function afterClarifying(facts: IntakeFacts, answers: boolean, big: boolean): ClarifiedStart {
  if (facts.level === 'full-auto' || big) return 'plan_first';
  return answers ? 'answer' : 'build';
}

function answersFirst(question: IntakeCall, request: string): boolean {
  if (question.source === 'jev') return question.value;
  if (question.jev !== null) return !buildsByRule(request);
  return question.rule === true;
}

function recentTask(facts: IntakeFacts): boolean {
  const last = facts.currentTask?.lastReplyAt;
  if (!last) return false;
  return (facts.now ?? new Date()).getTime() - last.getTime() <= FOLLOW_UP_MINUTES * 60_000;
}

function vagueRule(facts: IntakeFacts): boolean {
  if (facts.firstMessage) return vagueByRule(facts.request, facts.namedFiles);
  return vagueFollowUpByRule({
    request: facts.request,
    namedFiles: facts.namedFiles,
    previousReply: facts.previousReply ?? null,
    recentTask: recentTask(facts),
  });
}

const USER_CHANGE: IntakeCall = { jev: null, rule: null, value: true, source: 'user', gate: null };

export function decideIntake(jev: JevIntake | null, facts: IntakeFacts): IntakeDecisions {
  const doing = facts.mode === 'do';
  const ruleRisk: Risk = doing ? 'edits' : 'read-only';
  if (!doing) {
    return {
      start: 'answer',
      then: 'answer',
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
  const answers = answersFirst(question, facts.request);
  const calls: Record<string, IntakeCall> = {
    question: { ...question, value: answers },
    ...(planOnly ? { plan_only: { ...planCall, value: planOnly } } : {}),
    review: review,
    destructive: { ...destructiveCall, value: destructive },
  };
  let continues: boolean | null = null;
  if (facts.currentTask) {
    const rule = followUpByRule(facts.request, facts.currentTask.lastReplyAt, facts.now);
    const continuesCall = call(jev, 'continuesTask', 'continues_task', rule, facts, risk);
    continues = continuesCall.value;
    calls.continues_task = continuesCall;
  }
  const vagueCall = call(jev, 'vague', 'vague', vagueRule(facts), facts, risk);
  const vague = vagueCall.value && !(continues === true && !facts.firstMessage);
  calls.vague = { ...vagueCall, value: vague };
  const trivial = !destructive && trivialByRule(facts.request);
  if (facts.change) {
    calls.change = USER_CHANGE;
    return {
      start: 'build',
      then: 'build',
      review: review.value,
      destructive,
      trivial,
      continues,
      risk,
      calls,
    };
  }
  const existing = reviewsExistingByRule(facts.request);
  const reviewOnly = existing || (review.value && answers);
  const big = !facts.hasAgreedPlan && bigByRule(facts.request) !== null;
  const start = startMode({ planOnly, reviewOnly, vague, answers, big });
  return {
    start,
    then: afterClarifying(facts, answers, big),
    review: review.value || start === 'review',
    destructive,
    trivial,
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
