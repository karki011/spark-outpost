import type { DraftChat } from './outposts.ts';

export type StoryProblemKind = 'cycle' | 'self' | 'unknown' | 'duplicate_handle' | 'duplicate_chat';

export interface StoryProblem {
  kind: StoryProblemKind;
  handle: string;
  text: string;
}

export type StoryChat = Pick<DraftChat, 'handle' | 'dependsOn'> &
  Partial<Pick<DraftChat, 'chatId'>>;

export type StoryProblems = (chats: readonly StoryChat[]) => StoryProblem[];

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

function duplicateChatProblems(chats: readonly StoryChat[]): StoryProblem[] {
  const first = new Map<string, string>();
  const problems: StoryProblem[] = [];
  for (const { handle, chatId } of chats) {
    if (chatId === undefined) continue;
    const earlier = first.get(chatId);
    if (earlier === undefined) {
      first.set(chatId, handle);
      continue;
    }
    problems.push({
      kind: 'duplicate_chat',
      handle,
      text: `@${handle} names the same existing chat as @${earlier}.`,
    });
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
  return [
    ...duplicateProblems(chats),
    ...duplicateChatProblems(chats),
    ...dependencies,
    ...cycleProblems(known),
  ];
};
