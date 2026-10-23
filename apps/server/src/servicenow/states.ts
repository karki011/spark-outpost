import type { TicketStatus } from '@spark-outpost/contracts';
import type { MoveSettings, SourceMoveSettings } from '../tickets/move-target.ts';
import { settingsFor } from '../tickets/move-target.ts';
import { bucketOf, type SourceState, type StateKind } from '../tickets/status.ts';

export interface ServiceNowState extends SourceState {
  value: string;
}

const FINAL =
  /^(?:resolved|closed|cancel+ed|closed[\s_-]+(?:complete|incomplete|skipped)|complete|completed)$/i;
const RESOLVED = /^resolved$/i;
const NOT_STARTED = /^(?:new|open|pending|draft|requested|assess|authorize|scheduled)$/i;

export function isFinalState(label: string): boolean {
  return FINAL.test(label.trim());
}

const CLOSING_WORDS =
  /\b(?:resolved?|closed?|cancel(?:l?ed)?|completed?|done|withdrawn|fulfilled|rejected|abandoned|duplicate|retired)\b/i;

const FINAL_VALUES: Readonly<Record<string, readonly string[]>> = {
  incident: ['6', '7', '8'],
  problem: ['106', '107'],
  sc_req_item: ['3', '4', '7'],
  sc_task: ['3', '4', '7'],
  change_request: ['3', '4'],
};

export function isClosingState(table: string, state: { name: string; value: string }): boolean {
  return (
    isFinalState(state.name) ||
    CLOSING_WORDS.test(state.name) ||
    (FINAL_VALUES[table] ?? []).includes(state.value)
  );
}

export function stateKind(label: string): StateKind {
  const name = label.trim();
  if (isFinalState(name) && !RESOLVED.test(name)) return 'done';
  if (NOT_STARTED.test(name)) return 'todo';
  return 'started';
}

export function stateOf(value: string, label: string): ServiceNowState {
  return { value, name: label, kind: stateKind(label) };
}

export function serviceNowSettings(moves: SourceMoveSettings, table: string): MoveSettings {
  const settings = settingsFor(moves, table);
  return { ...settings, mapped: { in_review: 'Resolved', ...settings.mapped } };
}

export function serviceNowStatus(label: string, settings: MoveSettings): TicketStatus {
  return bucketOf(
    { name: label, kind: stateKind(label) },
    { ...settings.chosen, ...settings.mapped },
  );
}
