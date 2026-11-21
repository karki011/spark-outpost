import type { ConversationSummary } from '@spark-outpost/contracts';

export interface SubChatTree {
  roots: ConversationSummary[];
  subs: ReadonlyMap<string, readonly ConversationSummary[]>;
}

export const subChatFoldKey = (parentId: string): string => `sub-chats:${parentId}`;
export const subChatRowsId = (parentId: string): string => `sub-chats:${parentId}`;

export function flatTree(chats: readonly ConversationSummary[]): SubChatTree {
  return { roots: [...chats], subs: new Map() };
}

function listedParents(chats: readonly ConversationSummary[]): Set<string> {
  return new Set(chats.filter((chat) => !chat.archivedAt && !chat.subChat).map((chat) => chat.id));
}

function nestsUnder(chat: ConversationSummary, parents: ReadonlySet<string>): string | null {
  if (chat.archivedAt || !chat.subChat || !chat.parent) return null;
  return parents.has(chat.parent.id) ? chat.parent.id : null;
}

export function subChatTree(chats: readonly ConversationSummary[]): SubChatTree {
  const parents = listedParents(chats);
  const subs = new Map<string, ConversationSummary[]>();
  const roots: ConversationSummary[] = [];
  for (const chat of chats) {
    const parentId = nestsUnder(chat, parents);
    if (parentId === null) roots.push(chat);
    else subs.set(parentId, [...(subs.get(parentId) ?? []), chat]);
  }
  for (const [parentId, listed] of subs) {
    subs.set(
      parentId,
      listed.toSorted((a, b) => (a.subChat?.position ?? 0) - (b.subChat?.position ?? 0)),
    );
  }
  return { roots, subs };
}

export function needsYouCount(subs: readonly ConversationSummary[]): number {
  return subs.filter((chat) => chat.subChat?.status === 'needs_you').length;
}

export function needsYouLabel(count: number): string {
  return count === 1 ? '1 sub-chat needs you' : `${count} sub-chats need you`;
}

export function subChatCountLabel(count: number): string {
  return count === 1 ? '1 sub-chat' : `${count} sub-chats`;
}

export function treePlacement(tree: SubChatTree): string {
  return [...tree.subs]
    .flatMap(([parentId, listed]) => listed.map((chat) => `${chat.id}:${parentId}`))
    .join();
}

export function parentMarkText(chat: ConversationSummary): string | null {
  if (chat.parent) return `↳ ${chat.parent.title}`;
  if (chat.formerParent) return `· was part of ${chat.formerParent.title}`;
  return null;
}

export function nameInParent(chat: ConversationSummary): string {
  return chat.parent ? `${chat.title} in ${chat.parent.title}` : chat.title;
}

export function markedTitle(chat: ConversationSummary): string {
  const mark = parentMarkText(chat);
  return mark ? `${chat.title} ${mark}` : chat.title;
}
