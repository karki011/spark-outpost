import type { QueuedMessage, Run } from '@spark-outpost/contracts';

export type QueueMode = 'waiting' | 'paused' | 'held' | 'next';

export function queueMode(
  busy: boolean,
  runs: readonly Pick<Run, 'status'>[],
  sparkPaused: boolean,
): QueueMode {
  if (busy) return 'waiting';
  if (sparkPaused) return 'held';
  const last = runs.at(-1)?.status;
  return !last || last === 'succeeded' ? 'next' : 'paused';
}

export function queuedCount(count: number): string {
  return `${count} queued`;
}

export function queueNote(mode: QueueMode, count: number): string {
  if (mode === 'paused') return 'Paused because the last turn stopped. Send one now to go on.';
  if (mode === 'held') return 'Held while Spark is paused. Send one now to go on.';
  if (mode === 'next') return 'Sending the next one…';
  return count === 1 ? 'Sends when this turn ends' : 'Send in order when this turn ends';
}

export function canEdit(item: Pick<QueuedMessage, 'outpostPostId'>): boolean {
  return !item.outpostPostId;
}

export function movedIds(
  items: readonly Pick<QueuedMessage, 'id'>[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const ids = items.map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return ids;
}

export function inOrder(items: readonly QueuedMessage[], ids: readonly string[]): QueuedMessage[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids
    .flatMap((id) => byId.get(id) ?? [])
    .map((item, index) => ({ ...item, position: index + 1 }));
}

export function queuedItem(id: string, content: string, after: readonly QueuedMessage[]) {
  const last = after.at(-1)?.position ?? 0;
  return {
    id,
    content,
    position: last + 1,
    continueRunId: null,
    createdAt: new Date().toISOString(),
  } satisfies QueuedMessage;
}
