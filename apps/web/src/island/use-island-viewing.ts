import { useEffect, useMemo, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { useMarkSeen } from '../conversations/use-mark-seen.ts';
import { useReportViewedChat, useViewedChats } from '../desktop/use-viewed-chats.ts';
import { cardKey, type Card, type Moment } from './island-model.ts';

const NONE: ReadonlySet<string> = new Set();

export function acknowledged(
  previous: ReadonlySet<string>,
  pending: readonly Card[],
  viewed: ReadonlySet<string>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const card of pending) {
    const key = cardKey(card);
    if (previous.has(key) || viewed.has(card.chat.id)) keys.add(key);
  }
  const same = keys.size === previous.size && [...keys].every((key) => previous.has(key));
  return same ? previous : keys;
}

export function unacknowledged(
  cards: readonly Card[],
  seen: ReadonlySet<string>,
  viewed: ReadonlySet<string>,
): Card[] {
  return cards.filter((card) => !seen.has(cardKey(card)) && !viewed.has(card.chat.id));
}

interface IslandViewingOptions {
  openChatId: string | null;
  chats: readonly ConversationSummary[];
  pending: readonly Card[];
  cards: readonly Card[];
  moment: Moment | null;
  dismissMoment: () => void;
}

export function useIslandViewing(options: IslandViewingOptions) {
  const { openChatId, chats, pending, cards, moment, dismissMoment } = options;
  useReportViewedChat(openChatId);
  useMarkSeen(openChatId, chats);
  const viewed = useViewedChats();
  const [seen, setSeen] = useState<ReadonlySet<string>>(NONE);
  const nextSeen = acknowledged(seen, pending, viewed);
  if (nextSeen !== seen) setSeen(nextSeen);
  useEffect(() => {
    if (moment && viewed.has(moment.chatId)) dismissMoment();
  }, [moment, viewed, dismissMoment]);
  const fresh = useMemo(() => unacknowledged(cards, seen, viewed), [cards, seen, viewed]);
  const unviewed = useMemo(
    () => pending.filter((card) => !viewed.has(card.chat.id)),
    [pending, viewed],
  );
  return { viewed, fresh, unviewed };
}
