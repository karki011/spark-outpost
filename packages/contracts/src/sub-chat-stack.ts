import type { SubChatPullState } from './sub-chat-status.ts';

export interface StackOrderItem {
  conversationId: string;
  dependsOn: string | null;
  position: number;
}

export interface PrBaseFacts {
  defaultBranch: string;
  parentBranch: string | null;
  parentPull: { state: SubChatPullState } | null;
}

function parentPullEnded(facts: PrBaseFacts): boolean {
  return facts.parentPull !== null && facts.parentPull.state !== 'open';
}

export function prBase(facts: PrBaseFacts): string {
  if (facts.parentBranch === null || parentPullEnded(facts)) return facts.defaultBranch;
  return facts.parentBranch;
}

function byPosition<Item extends StackOrderItem>(tasks: readonly Item[]): Item[] {
  return tasks.toSorted((a, b) => a.position - b.position);
}

function parentIn<Item extends StackOrderItem>(task: Item, ids: ReadonlySet<string>) {
  const parent = task.dependsOn;
  return parent !== null && parent !== task.conversationId && ids.has(parent) ? parent : null;
}

export function stackOrder<Item extends StackOrderItem>(tasks: readonly Item[]): Item[] {
  const sorted = byPosition(tasks);
  const ids = new Set(sorted.map((task) => task.conversationId));
  const placed = new Set<Item>();
  const ordered: Item[] = [];

  const place = (task: Item): void => {
    if (placed.has(task)) return;
    placed.add(task);
    ordered.push(task);
    for (const child of sorted) {
      if (parentIn(child, ids) === task.conversationId) place(child);
    }
  };

  for (const task of sorted) {
    if (parentIn(task, ids) === null) place(task);
  }
  for (const task of sorted) place(task);
  return ordered;
}
