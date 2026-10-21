import { alertingChats, approvalAttentionKey, type AttentionItem } from '@spark-outpost/contracts';
import type { Card } from './island-model.ts';

export function cardItem(card: Card, items: readonly AttentionItem[]): AttentionItem | null {
  const approval = card.approval;
  if (approval) return items.find((item) => item.key === approvalAttentionKey(approval.id)) ?? null;
  return items.find((item) => item.blocking && item.conversationId === card.chat.id) ?? null;
}

export function cardItemKey(card: Card, items: readonly AttentionItem[]): string | null {
  const item = cardItem(card, items);
  if (item) return item.key;
  return card.approval ? approvalAttentionKey(card.approval.id) : null;
}

export interface InboxCards {
  waiting: Card[];
  aside: Card[];
  unread: Card[];
  seen: ReadonlySet<Card>;
}

export function inboxCards(
  cards: readonly Card[],
  items: readonly AttentionItem[],
  loaded: boolean,
): InboxCards {
  const sorted: InboxCards = { waiting: [], aside: [], unread: [], seen: new Set() };
  const seen = new Set<Card>();
  const alertingIds = alertingChats(items);
  for (const card of cards) {
    const item = cardItem(card, items);
    if (loaded && !item) continue;
    if (item?.dismissedAt) continue;
    if (item?.setAsideAt && !alertingIds.has(card.chat.id)) {
      sorted.aside.push(card);
      continue;
    }
    sorted.waiting.push(card);
    if (loaded && alertingIds.has(card.chat.id)) sorted.unread.push(card);
    else if (item?.readAt) seen.add(card);
  }
  return { ...sorted, seen };
}
