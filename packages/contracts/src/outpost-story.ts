import type { DraftChat, RequestState, StackWarning, StoryPullState } from './outposts.ts';

export type StoryProblemKind = 'cycle' | 'self' | 'unknown' | 'duplicate_handle';

export interface StoryProblem {
  kind: StoryProblemKind;
  handle: string;
  text: string;
}

export type StoryChat = Pick<DraftChat, 'handle' | 'dependsOn'>;

export interface StoryOrderItem {
  conversationId: string;
  dependsOn: string | null;
  position: number;
}

export interface StackSide {
  projectId: string | null;
  chatId?: string | undefined;
}

export interface StackFacts {
  handle: string;
  parentHandle: string;
  defaultBranch: string;
  branch: string | null;
  pull: { state: StoryPullState; base: string | null } | null;
  parentBranch: string | null;
  parentOnRemote: boolean;
  parentInBranch: boolean | null;
  parentState: RequestState | null;
  parentPull: { state: StoryPullState } | null;
}

export type StoryProblems = (chats: readonly StoryChat[]) => StoryProblem[];
export type StoryOrder = <Item extends StoryOrderItem>(tasks: readonly Item[]) => Item[];
export type IsStacked = (task: StackSide, parent: StackSide | null) => boolean;
export type StackWarnings = (facts: StackFacts) => StackWarning[];
export type PrBase = (facts: StackFacts) => string;

function firstByHandle(chats: readonly StoryChat[]): Map<string, StoryChat> {
  const byHandle = new Map<string, StoryChat>();
  for (const chat of chats) {
    if (!byHandle.has(chat.handle)) byHandle.set(chat.handle, chat);
  }
  return byHandle;
}

function duplicateProblems(chats: readonly StoryChat[]): StoryProblem[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const problems: StoryProblem[] = [];
  for (const { handle } of chats) {
    if (seen.has(handle) && !reported.has(handle)) {
      reported.add(handle);
      problems.push({
        kind: 'duplicate_handle',
        handle,
        text: `@${handle} is used by more than one chat.`,
      });
    }
    seen.add(handle);
  }
  return problems;
}

function dependencyProblem(chat: StoryChat, known: ReadonlyMap<string, StoryChat>) {
  const { handle, dependsOn } = chat;
  if (dependsOn === undefined) return null;
  if (dependsOn === handle) {
    const text = `@${handle} cannot start after itself.`;
    return { kind: 'self', handle, text } satisfies StoryProblem;
  }
  if (!known.has(dependsOn)) {
    const text = `@${handle} starts after @${dependsOn}, which is not in this draft.`;
    return { kind: 'unknown', handle, text } satisfies StoryProblem;
  }
  return null;
}

function cycleFrom(start: string, known: ReadonlyMap<string, StoryChat>): string[] | null {
  const path = [start];
  let next = known.get(start)?.dependsOn;
  while (next !== undefined && known.has(next)) {
    if (next === start) return path.length > 1 ? path : null;
    if (path.includes(next)) return null;
    path.push(next);
    next = known.get(next)?.dependsOn;
  }
  return null;
}

function cycleProblems(known: ReadonlyMap<string, StoryChat>): StoryProblem[] {
  const inCycle = new Set<string>();
  const problems: StoryProblem[] = [];
  for (const handle of known.keys()) {
    if (inCycle.has(handle)) continue;
    const cycle = cycleFrom(handle, known);
    if (cycle === null) continue;
    for (const member of cycle) inCycle.add(member);
    const text = [...cycle, handle].map((member) => `@${member}`).join(' → ');
    problems.push({ kind: 'cycle', handle, text });
  }
  return problems;
}

export const storyProblems: StoryProblems = (chats) => {
  const known = firstByHandle(chats);
  const dependencies = chats
    .map((chat) => dependencyProblem(chat, known))
    .filter((problem) => problem !== null);
  return [...duplicateProblems(chats), ...dependencies, ...cycleProblems(known)];
};

function byPosition<Item extends StoryOrderItem>(tasks: readonly Item[]): Item[] {
  return tasks.toSorted((a, b) => a.position - b.position);
}

function parentIn<Item extends StoryOrderItem>(task: Item, ids: ReadonlySet<string>) {
  const parent = task.dependsOn;
  return parent !== null && parent !== task.conversationId && ids.has(parent) ? parent : null;
}

export const storyOrder: StoryOrder = <Item extends StoryOrderItem>(tasks: readonly Item[]) => {
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
};

export const isStacked: IsStacked = (task, parent) =>
  parent !== null &&
  task.chatId === undefined &&
  task.projectId !== null &&
  task.projectId === parent.projectId;

export interface StackedChat extends StackSide {
  handle: string;
  dependsOn?: string | undefined;
}

export function stackedCount(chats: readonly StackedChat[]): number {
  const byHandle = new Map(chats.map((chat) => [chat.handle, chat]));
  return chats.filter((chat) =>
    isStacked(chat, chat.dependsOn === undefined ? null : (byHandle.get(chat.dependsOn) ?? null)),
  ).length;
}
