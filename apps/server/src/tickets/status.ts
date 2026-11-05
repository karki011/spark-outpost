import {
  ticketStatusLabels,
  type TicketStatus,
  type TicketStatusMap,
} from '@spark-outpost/contracts';

export type StateKind = 'todo' | 'started' | 'done';

export interface SourceState {
  name: string;
  kind: StateKind;
}

const ORDER: readonly TicketStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
const REVIEW = /review/i;

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function projectMap(
  map: TicketStatusMap,
  project: string | null,
): Partial<Record<TicketStatus, string>> {
  if (!project) return {};
  const entry = Object.entries(map).find(([key]) => sameName(key, project));
  return entry?.[1] ?? {};
}

export function bucketOf(
  state: SourceState,
  mapped: Partial<Record<TicketStatus, string>> = {},
): TicketStatus {
  const configured = ORDER.find((status) => mapped[status] && sameName(mapped[status], state.name));
  if (configured) return configured;
  if (state.kind === 'todo') return 'todo';
  if (state.kind === 'done') return 'done';
  return REVIEW.test(state.name) ? 'in_review' : 'in_progress';
}

export type MoveDecision = { move: true } | { move: false; reason: string };

export function shouldMove(current: TicketStatus, target: TicketStatus): MoveDecision {
  if (current === target) {
    return { move: false, reason: `Already ${ticketStatusLabels[target]}.` };
  }
  if (target !== 'done' && ORDER.indexOf(current) > ORDER.indexOf(target)) {
    return {
      move: false,
      reason: `Left at ${ticketStatusLabels[current]}; it is further along than ${ticketStatusLabels[target]}.`,
    };
  }
  return { move: true };
}

export function noStateMessage(target: TicketStatus, project: string | null): string {
  const where = project ? ` in ${project}` : '';
  return `No status maps to ${ticketStatusLabels[target]}${where}. Choose one in Settings → Connectors.`;
}
