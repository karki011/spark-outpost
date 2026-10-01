import type { OrchestrationPhase } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import {
  validChoice,
  type IntakeQuestions,
  type SystemOneResponse,
} from '../advisor/intake-questions.ts';
import { capped } from '../advisor/questions.ts';

export type ChatState = 'not_started' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'stopped';

export interface ChatFacts {
  title: string;
  state: ChatState;
  phase: OrchestrationPhase | null;
  step: string | null;
  agent: { name: string; role: string } | null;
  steps: { done: number; total: number } | null;
  files: string[];
  checks: { status: 'passed' | 'failed' | 'skipped'; failing: number } | null;
  costUsd: number | null;
  waitingOn: string | null;
  error: string | null;
  quietMinutes: number | null;
}

const HEADLINES = ['on_track', 'needs_you', 'stuck', 'wrapping_up', 'done', 'failed'] as const;
export type Headline = (typeof HEADLINES)[number];

const NEXT_KEYS = [
  'answer',
  'finish_step',
  'run_checks',
  'fix_checks',
  'review',
  'keep',
  'look_over',
  'nothing',
  'retry',
  'start',
] as const;
type NextKey = (typeof NEXT_KEYS)[number];

export interface UpdatePlan {
  headlines: Headline[];
  next: NextKey[];
  rules: { headline: Headline; next: NextKey };
}

export interface UpdatePick {
  headline: Headline;
  next: NextKey;
  byJev: boolean;
}

export const STUCK_MINUTES = 10;
export const UPDATE_ACT_AT = 0.6;

const HEADLINE_TEXT: Record<Headline, string> = {
  on_track: 'On track.',
  needs_you: 'Waiting on you.',
  stuck: 'Seems stuck.',
  wrapping_up: 'Nearly done.',
  done: 'Done.',
  failed: 'Couldn’t finish.',
};

const HEADLINE_CRITERIA: Record<Headline, string> = {
  on_track: 'Work is moving: steps are finishing and nothing is waiting on the user',
  needs_you: 'The chat is paused until the user answers a question or approves an action',
  stuck: 'The same step has run a long time with no new activity, or checks keep failing',
  wrapping_up: 'Most steps are done and the work is in review or final checks',
  done: 'The work finished',
  failed: 'The work stopped with an error or was cancelled',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function trimEnd(text: string): string {
  return text.trim().replace(/[.…\s]+$/, '');
}

function nextText(key: NextKey, facts: ChatFacts): string {
  switch (key) {
    case 'answer':
      return facts.waitingOn ? `your answer on “${facts.waitingOn}”` : 'your answer in the chat';
    case 'finish_step':
      return facts.step ? `finish ${lowerFirst(trimEnd(facts.step))}` : 'finish the current step';
    case 'run_checks':
      return 'run the project checks';
    case 'fix_checks':
      return 'fix the failing checks';
    case 'review':
      return 'the Critic reviews the change';
    case 'keep':
      return 'keep the changes once the checks pass';
    case 'look_over':
      return 'look over the changes in Spark';
    case 'nothing':
      return 'nothing, it’s finished';
    case 'retry':
      return 'retry, or open the chat to see what went wrong';
    case 'start':
      return 'send a message to start';
  }
}

function runningNext(facts: ChatFacts): NextKey[] {
  if (facts.checks?.status === 'failed') return ['fix_checks', 'finish_step', 'review'];
  if (facts.phase === 'reviewing') return ['review', 'keep', 'fix_checks'];
  if (facts.phase === 'building') return ['finish_step', 'run_checks', 'review'];
  return ['finish_step', 'run_checks', 'keep'];
}

export function updatePlan(facts: ChatFacts): UpdatePlan {
  switch (facts.state) {
    case 'not_started':
      return {
        headlines: ['on_track'],
        next: ['start'],
        rules: { headline: 'on_track', next: 'start' },
      };
    case 'waiting':
      return {
        headlines: ['needs_you'],
        next: ['answer'],
        rules: { headline: 'needs_you', next: 'answer' },
      };
    case 'failed':
    case 'stopped':
      return {
        headlines: ['failed'],
        next: ['retry'],
        rules: { headline: 'failed', next: 'retry' },
      };
    case 'succeeded': {
      const next: NextKey[] = facts.files.length > 0 ? ['look_over', 'nothing'] : ['nothing'];
      return { headlines: ['done'], next, rules: { headline: 'done', next: next[0]! } };
    }
    case 'running': {
      const next = runningNext(facts);
      return {
        headlines: ['on_track', 'stuck', 'wrapping_up'],
        next,
        rules: { headline: runningHeadline(facts), next: next[0]! },
      };
    }
  }
}

function runningHeadline(facts: ChatFacts): Headline {
  if ((facts.quietMinutes ?? 0) >= STUCK_MINUTES) return 'stuck';
  if (facts.phase === 'reviewing') return 'wrapping_up';
  if (facts.steps && facts.steps.total > 1 && facts.steps.done >= facts.steps.total - 1) {
    return 'wrapping_up';
  }
  return 'on_track';
}

export function asksJev(plan: UpdatePlan): boolean {
  return plan.headlines.length > 1 || plan.next.length > 1;
}

export function updateQuestions(facts: ChatFacts, plan: UpdatePlan): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {};
  if (plan.headlines.length > 1) {
    questions.update_state = {
      type: 'choice',
      instructions: 'Which best describes how `chat` is going right now?',
      criteria: Object.fromEntries(
        plan.headlines.map((headline) => [headline, { what: HEADLINE_CRITERIA[headline] }]),
      ),
    };
  }
  if (plan.next.length > 1) {
    questions.update_next = {
      type: 'choice',
      instructions: 'What most likely happens next in `chat`?',
      criteria: Object.fromEntries(
        plan.next.map((key) => [key, { what: capped(nextText(key, facts), 200) }]),
      ),
    };
  }
  return {
    state: {
      chat: {
        title: capped(redactText(facts.title), 200),
        status: facts.state,
        phase: facts.phase ?? 'none',
        step: facts.step ? capped(redactText(facts.step), 200) : 'none',
        steps: facts.steps ?? 'no plan',
        files_changed: facts.files.length,
        checks: facts.checks ?? 'not run yet',
        minutes_since_activity: facts.quietMinutes ?? 'unknown',
      },
    },
    questions,
  };
}

function accepted<T extends string>(
  response: SystemOneResponse | null,
  key: string,
  offered: readonly T[],
): T | null {
  if (offered.length < 2) return null;
  const choice = validChoice(response, key, offered);
  return choice && choice.confidence >= UPDATE_ACT_AT ? choice.value : null;
}

export function pickUpdate(plan: UpdatePlan, response: SystemOneResponse | null): UpdatePick {
  const headline = accepted(response, 'update_state', plan.headlines);
  const next = accepted(response, 'update_next', plan.next);
  return {
    headline: headline ?? plan.rules.headline,
    next: next ?? plan.rules.next,
    byJev: headline !== null || next !== null,
  };
}

function progressLine(facts: ChatFacts): string {
  if (facts.state === 'not_started') return 'Nothing has started yet.';
  if (facts.state === 'failed' || facts.state === 'stopped') {
    const reason = facts.error ? capped(trimEnd(redactText(facts.error)), 140) : null;
    return reason ? `${reason}.` : 'It stopped before the work was done.';
  }
  const parts: string[] = [];
  if (facts.steps) parts.push(`${facts.steps.done} of ${facts.steps.total} steps done.`);
  if (facts.state === 'waiting' && facts.waitingOn) {
    parts.push(`${facts.agent?.name ?? 'The agent'} is waiting for your OK.`);
  } else if (facts.state === 'running' && facts.step) {
    const who = facts.agent?.name ?? 'The agent';
    parts.push(`${who} is ${lowerFirst(trimEnd(facts.step))}.`);
  }
  return parts.join(' ');
}

function filesText(files: readonly string[]): string {
  const names = files.slice(0, 2).map((file) => file.split('/').at(-1) ?? file);
  const more = files.length - names.length;
  const list = more > 0 ? `${names.join(', ')} and ${more} more` : names.join(' and ');
  return `Changed ${plural(files.length, 'file', 'files')} (${list})`;
}

function checksText(facts: ChatFacts): string | null {
  const checks = facts.checks;
  if (!checks) return facts.state === 'running' ? 'checks haven’t run yet' : null;
  if (checks.status === 'passed') return 'checks passed';
  if (checks.status === 'skipped') return 'checks were skipped';
  return `${plural(checks.failing, 'check', 'checks')} failing`;
}

function costText(facts: ChatFacts): string | null {
  if (facts.costUsd === null) return null;
  const amount = `$${facts.costUsd.toFixed(2)}`;
  return facts.state === 'running' || facts.state === 'waiting' ? `${amount} so far` : amount;
}

function workLine(facts: ChatFacts): string | null {
  if (facts.state === 'not_started') return null;
  const files =
    facts.files.length > 0
      ? filesText(facts.files)
      : facts.state === 'succeeded'
        ? 'No files changed'
        : 'No files changed yet';
  const rest = [checksText(facts), costText(facts)].filter((part) => part !== null);
  return rest.length > 0 ? `${files}; ${rest.join(' · ')}.` : `${files}.`;
}

export function composeUpdate(facts: ChatFacts, pick: UpdatePick): string[] {
  const progress = progressLine(facts);
  const first = progress
    ? `${HEADLINE_TEXT[pick.headline]} ${progress}`
    : HEADLINE_TEXT[pick.headline];
  const work = workLine(facts);
  const next = `Next: ${nextText(pick.next, facts)}.`;
  return [first, ...(work ? [work] : []), next];
}
