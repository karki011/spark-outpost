import { createContext, useContext } from 'react';

export interface ScreenState {
  chatsView: boolean;
  outpostOpen: boolean;
  settingsOpen: boolean;
  shownIds: readonly string[];
}

const NONE: readonly string[] = [];

export function onScreenChatIds(screen: ScreenState): readonly string[] {
  if (!screen.chatsView || screen.outpostOpen || screen.settingsOpen) return NONE;
  return screen.shownIds;
}

export const OnScreenChat = createContext<readonly string[]>(NONE);

export function useChatOnScreen(chatId: string): boolean {
  return useContext(OnScreenChat).includes(chatId);
}
