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
