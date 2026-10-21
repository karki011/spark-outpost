import { useEffect } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { useMarkSeen } from '../conversations/use-mark-seen.ts';
import { useReportViewedChat, useViewedChats } from '../desktop/use-viewed-chats.ts';
import type { Moment } from './island-model.ts';

interface IslandChatState {
  review: string | null;
  selfOpened: string | null;
  focusSignal: number;
}

export function islandViewedChat(state: IslandChatState): string | null {
  const openedByUser = state.review !== state.selfOpened || state.focusSignal > 0;
  return state.review && openedByUser ? state.review : null;
}

interface IslandViewingOptions {
  openChatId: string | null;
  chats: readonly ConversationSummary[];
  moment: Moment | null;
  dismissMoment: () => void;
}

export function useIslandViewing(options: IslandViewingOptions): void {
  const { openChatId, chats, moment, dismissMoment } = options;
  useReportViewedChat(openChatId);
  useMarkSeen(openChatId, chats);
  const viewed = useViewedChats();
  useEffect(() => {
    if (moment && viewed.has(moment.chatId)) dismissMoment();
  }, [moment, viewed, dismissMoment]);
}
