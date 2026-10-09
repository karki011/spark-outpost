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
