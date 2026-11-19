import {
  anyTriggerOn,
  workflowTriggersSchema,
  type PublishHold,
  type QueuedTriggerKind,
  type TriggerEvent,
  type WorkflowTriggers,
} from '@spark-outpost/contracts';
import type { HourCycle } from '../calendar/clock-format.ts';
import { whenLine, type HistoryTone } from './schedule-model.ts';

export function defaultTriggers(): WorkflowTriggers {
  return workflowTriggersSchema.parse({});
}

export function triggerProblem(triggers: WorkflowTriggers): string | null {
  if (!Number.isInteger(triggers.debounceMinutes) || triggers.debounceMinutes < 0) {
    return 'Wait must be a whole number of minutes.';
  }
  if (triggers.holdOnFindings && !triggers.beforePublish) {
    return 'Holding a publish needs Before publish on.';
  }
  return null;
}

export function triggersSummary(triggers: WorkflowTriggers | null): string {
  if (!triggers || !anyTriggerOn(triggers)) return 'Off · no event starts this workflow';
  const parts = [
    triggers.chatStarted && 'a chat starts',
    triggers.turnChanged && 'a turn changes files',
    triggers.beforePublish && 'before publish',
    triggers.commit && 'a new commit',
    triggers.pullRequest && 'a pull request opens or updates',
  ].filter((part): part is string => typeof part === 'string');
  return `On · runs when ${parts.join(', ')}`;
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
};

export interface EventRow {
  key: string;
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
