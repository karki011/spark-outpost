import { useMemo } from 'react';
import {
  approvalAttentionKey,
  type Approval,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import {
  useAttentionItems,
  useHandledAttention,
  useMarkAttention,
  useReadChat,
} from '../attention/use-attention.ts';
import { useViewedChats } from '../desktop/use-viewed-chats.ts';
import { cardItemKey, inboxCards } from './inbox-state.ts';
import { pendingCards, type Card } from './island-model.ts';
import type { Alert } from './island-sound.ts';

export function useIslandAttention(
  chats: readonly ConversationSummary[],
  approvalsByChat: ReadonlyMap<string, readonly Approval[]>,
) {
  const { items, loaded } = useAttentionItems();
  const mark = useMarkAttention();
  const forget = useHandledAttention();
  const readChat = useReadChat();
  const viewed = useViewedChats();
  const allCards = useMemo(() => {
    const putOff = new Set(
      items
        .filter((item) => item.setAsideAt !== null || item.dismissedAt !== null)
        .map((item) => item.key),
    );
    return pendingCards(chats, approvalsByChat, (id) => putOff.has(approvalAttentionKey(id)));
  }, [chats, approvalsByChat, items]);
  const sorted = useMemo(() => inboxCards(allCards, items, loaded), [allCards, items, loaded]);
  const alerts = useMemo(
    (): Alert[] | null =>
      loaded
        ? sorted.unread.map((card) => ({
            key: cardItemKey(card, items) ?? card.chat.id,
            chatId: card.chat.id,
          }))
        : null,
    [loaded, sorted.unread, items],
  );
  const markCard = (card: Card, what: 'read' | 'set-aside') => {
    const key = cardItemKey(card, items);
    if (key) mark([key], what);
  };
  return {
    items,
    allCards,
    cards: sorted.waiting,
    aside: sorted.aside,
    fresh: sorted.unread,
    seen: sorted.seen,
    alerts,
    viewed,
    read: (card: Card) => markCard(card, 'read'),
    setAside: (card: Card) => markCard(card, 'set-aside'),
    clear: (key: string) => mark([key], 'read'),
    handled: (card: Card) => {
      const key = cardItemKey(card, items);
      if (key) forget(key);
    },
    readChat,
  };
}
