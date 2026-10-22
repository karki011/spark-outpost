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

export type TodoChange = 'added' | 'changed';

export interface TurnEntry {
  entry: PlanEntry;
  change: TodoChange;
}

function sameContentMatches(
  previous: readonly PlanEntry[],
  current: readonly PlanEntry[],
): Map<number, number> {
  const unused = new Set(previous.keys());
  const matches = new Map<number, number>();
  current.forEach((entry, index) => {
    const match = [...unused].find((candidate) => previous[candidate]!.content === entry.content);
    if (match === undefined) return;
    unused.delete(match);
    matches.set(index, match);
  });
  return matches;
}

export function turnChanges(
  previous: readonly PlanEntry[],
  current: readonly PlanEntry[],
): TurnEntry[] {
  const matches = sameContentMatches(previous, current);
  const taken = new Set(matches.values());
  return current.flatMap((entry, index): TurnEntry[] => {
    const match = matches.get(index);
    if (match !== undefined) {
      return previous[match]!.status === entry.status ? [] : [{ entry, change: 'changed' }];
    }
    if (index < previous.length && !taken.has(index)) {
      taken.add(index);
      return [{ entry, change: 'changed' }];
    }
    return [{ entry, change: 'added' }];
  });
}

interface TodoRun {
  id: string;
  createdAt: string;
  parentRunId?: string | null | undefined;
  todo?: readonly PlanEntry[] | null | undefined;
}

export function previousTodo(runs: readonly TodoRun[], runId: string): readonly PlanEntry[] {
  const own = runs.find((run) => run.id === runId);
  if (!own) return [];
  const earlier = runs
    .filter((run) => !run.parentRunId && run.todo && run.createdAt < own.createdAt)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  return earlier.at(-1)?.todo ?? [];
}

export function turnTodo(
  runs: readonly TodoRun[],
  runId: string,
  current: readonly PlanEntry[],
): readonly PlanEntry[] {
  return turnChanges(previousTodo(runs, runId), current).map((item) => item.entry);
}
