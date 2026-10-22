import type { PlanEntry, TaskItemState } from '@spark-outpost/contracts';

export interface TodoRow {
  id: string;
  label: string;
  state: TaskItemState;
}

export function shownTodo(
  streamed: readonly PlanEntry[] | null,
  stored: readonly PlanEntry[] | null | undefined,
): readonly PlanEntry[] {
  return streamed ?? stored ?? [];
}

function entryState(entry: PlanEntry, live: boolean): TaskItemState {
  if (entry.status === 'completed') return 'done';
  if (entry.status === 'failed') return 'failed';
  if (entry.status === 'in_progress' && live) return 'active';
  return 'pending';
}

export function todoRows(entries: readonly PlanEntry[], live: boolean): TodoRow[] {
  return entries.map((entry, index) => ({
    id: `todo:${index}`,
    label: entry.content,
    state: entryState(entry, live),
  }));
}

export function doneCount(entries: readonly PlanEntry[]): number {
  return entries.filter((entry) => entry.status === 'completed').length;
}

export function finishedText(entries: readonly PlanEntry[]): string {
  const done = doneCount(entries);
  const left = entries.length - done;
  const counted = `${done} of ${entries.length} done`;
  return left === 0 ? counted : `${counted} · ${left} not finished`;
}

export function currentTodo(entries: readonly PlanEntry[]): string | null {
  return entries.find((entry) => entry.status === 'in_progress')?.content ?? null;
}
