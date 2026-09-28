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
const PROGRESS = /progress|doing|develop/i;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function projectMap(
  map: TicketStatusMap,
  project: string | null,
): Partial<Record<TicketStatus, string>> {
  if (!project) return {};
  const entry = Object.entries(map).find(([key]) => same(key, project));
  return entry?.[1] ?? {};
}

export function bucketOf(
  state: SourceState,
  mapped: Partial<Record<TicketStatus, string>> = {},
): TicketStatus {
  const configured = ORDER.find((status) => mapped[status] && same(mapped[status], state.name));
  if (configured) return configured;
  if (state.kind === 'todo') return 'todo';
  if (state.kind === 'done') return 'done';
  return REVIEW.test(state.name) ? 'in_review' : 'in_progress';
}

function preference(target: TicketStatus, name: string): number {
  if (target === 'in_review') return REVIEW.test(name) ? 0 : 1;
  if (target === 'in_progress') return PROGRESS.test(name) ? 0 : 1;
  return 0;
}

export function pickState<T extends SourceState>(
  candidates: readonly T[],
  target: TicketStatus,
  mapped: Partial<Record<TicketStatus, string>> = {},
): T | null {
  const wanted = mapped[target];
  if (wanted) return candidates.find((state) => same(state.name, wanted)) ?? null;
  const matching = candidates.filter((state) => bucketOf(state, mapped) === target);
  const ranked = [...matching].sort(
    (a, b) => preference(target, a.name) - preference(target, b.name),
  );
  return ranked[0] ?? null;
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
