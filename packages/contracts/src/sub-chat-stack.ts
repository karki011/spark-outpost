import type { RequestState, StackWarning, StoryPullState } from './outposts.ts';

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

export type StoryOrder = <Item extends StoryOrderItem>(tasks: readonly Item[]) => Item[];
export type IsStacked = (task: StackSide, parent: StackSide | null) => boolean;
export type StackWarnings = (facts: StackFacts) => StackWarning[];
export type PrBase = (facts: StackFacts) => string;

function parentPullEnded(facts: StackFacts): boolean {
  return facts.parentPull !== null && facts.parentPull.state !== 'open';
}

export const prBase: PrBase = (facts) => {
  if (facts.parentBranch === null || parentPullEnded(facts)) return facts.defaultBranch;
  return facts.parentBranch;
};

function parentFailed(facts: StackFacts): StackWarning | null {
  const parent = `@${facts.parentHandle}`;
  if (facts.parentState === 'failed') return { kind: 'parent_failed', text: `${parent} failed` };
  if (facts.parentState === 'cancelled') {
    return { kind: 'parent_failed', text: `${parent} was cancelled` };
  }
  return null;
}

function parentNotPushed(facts: StackFacts): StackWarning | null {
  if (facts.parentOnRemote) return null;
  return {
    kind: 'parent_not_pushed',
    text: `@${facts.parentHandle}'s branch is not pushed, so @${facts.handle} cannot push`,
  };
}

function behindParent(facts: StackFacts): StackWarning | null {
  if (facts.branch === null || facts.parentInBranch !== false) return null;
  return {
    kind: 'behind_parent',
    text: `@${facts.parentHandle} has commits that @${facts.handle} does not have`,
  };
}

function baseMerged(facts: StackFacts, pullBase: string): StackWarning | null {
  if (!parentPullEnded(facts) || pullBase !== facts.parentBranch) return null;
  const trap = `Merging this now would not reach ${facts.defaultBranch}`;
  if (facts.parentPull?.state === 'merged') return { kind: 'base_merged', text: trap };
  return {
    kind: 'base_merged',
    text: `@${facts.parentHandle}'s pull request was closed. ${trap}`,
  };
}

function baseWarning(facts: StackFacts): StackWarning | null {
  const pullBase = facts.pull?.base ?? null;
  if (pullBase === null) return null;
  const expected = prBase(facts);
  if (pullBase === expected) return null;
  return (
    baseMerged(facts, pullBase) ?? {
      kind: 'base_mismatch',
      text: `The pull request targets ${pullBase}, not ${expected}`,
    }
  );
}

function liveStackWarnings(facts: StackFacts): (StackWarning | null)[] {
  if (prBase(facts) !== facts.parentBranch) return [];
  return [parentNotPushed(facts), behindParent(facts)];
}

export const stackWarnings: StackWarnings = (facts) => {
  if (facts.pull !== null && facts.pull.state !== 'open') return [];
  return [parentFailed(facts), ...liveStackWarnings(facts), baseWarning(facts)].filter(
    (warning) => warning !== null,
  );
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
