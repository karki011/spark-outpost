import {
  branchGlobs,
  branchMatches,
  workflowTriggersSchema,
  type PublishHold,
  type QueuedTriggerKind,
  type TriggerEvent,
  type WorkflowTriggers,
} from '@spark-outpost/contracts';
import type { HourCycle } from '../calendar/clock-format.ts';
import { whenLine, type HistoryTone } from './schedule-model.ts';
import { listed } from './workflow-model.ts';

export const BRANCHES_SHOWN = 4;

const UNMATCHABLE = /[~^:\\[]|\.\.|@\{|\/\/|^[-/.]|[/.]$|\.lock$/;

type TriggerSwitch = 'chatStarted' | 'turnChanged' | 'commit' | 'pullRequest' | 'beforePublish';

const TRIGGER_LABELS: readonly [TriggerSwitch, string][] = [
  ['chatStarted', 'Chat starts'],
  ['turnChanged', 'Turn changes files'],
  ['commit', 'New commit'],
  ['pullRequest', 'Pull request opens'],
  ['beforePublish', 'Before publish'],
];

export function defaultTriggers(): WorkflowTriggers {
  return workflowTriggersSchema.parse({});
}

export type TriggerSwitches = Pick<WorkflowTriggers, TriggerSwitch>;

export function triggerLabels(triggers: TriggerSwitches | null): string[] {
  if (!triggers) return [];
  return TRIGGER_LABELS.filter(([key]) => triggers[key]).map(([, label]) => label);
}

export function branchProblem(text: string): string | null {
  const bad = branchGlobs(text).filter((glob) => UNMATCHABLE.test(glob));
  if (bad.length === 0) return null;
  return `${listed(bad)} can never match a branch. A branch name has no ~ ^ : \\ [ or two dots in a row, and does not start with - or / or end with / or a dot.`;
}

export function matchingBranches(
  text: string,
  branches: readonly (string | null | undefined)[],
): string | null {
  if (branchGlobs(text).length === 0) return 'Every branch.';
  if (branchProblem(text) !== null) return null;
  const known = [...new Set(branches.filter((branch): branch is string => Boolean(branch)))];
  const matched = known.filter((branch) => branchMatches(text, branch));
  if (matched.length === 0) return 'No chat is on a matching branch right now.';
  const shown = matched.slice(0, BRANCHES_SHOWN);
  const more = matched.length - shown.length;
  return `Matches now: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`;
}

const KIND_WORDS: Record<QueuedTriggerKind, string> = {
  turn_changed: 'Turn changed files',
  commit: 'New commit',
  pull_request: 'Pull request',
  chat_started: 'Chat started',
};

const STATE_WORDS: Record<TriggerEvent['state'], [string, HistoryTone]> = {
  pending: ['Waiting', 'running'],
  claimed: ['Starting', 'running'],
  started: ['Started', 'succeeded'],
  skipped: ['Skipped', 'quiet'],
  not_started: ['Not started', 'failed'],
};

const REASON_WORDS: Record<NonNullable<TriggerEvent['reason']>, string> = {
  unchanged: 'Nothing changed since the last run',
  problem: 'The workflow has a problem',
  chat_gone: 'The chat was archived or deleted',
  error: 'Something went wrong',
  first_turn: 'The chat’s first turn failed or was stopped',
};

export interface EventRow {
  key: string;
  at: number;
  when: string;
  what: string;
  chat: string;
  state: string;
  tone: HistoryTone;
  note: string;
}

export function eventRow(event: TriggerEvent, now: Date, cycle: HourCycle): EventRow {
  const [state, tone] = STATE_WORDS[event.state];
  const at = new Date(event.state === 'pending' ? event.dueAt : event.updatedAt);
  const reason = event.reason ? REASON_WORDS[event.reason] : '';
  const note = event.detail ? `${reason}: ${event.detail}` : reason;
  return {
    key: event.id,
    at: at.getTime(),
    when:
      event.state === 'pending' ? `Starts ${whenLine(at, now, cycle)}` : whenLine(at, now, cycle),
    what: KIND_WORDS[event.kind],
    chat: event.chatTitle || 'Untitled chat',
    state,
    tone,
    note,
  };
}

export function holdLine(hold: PublishHold): string {
  if (!hold.finished) return 'The review did not finish';
  const count = hold.findings;
  return `${count} Critical or High ${count === 1 ? 'finding' : 'findings'}`;
}
