import { createContext, useContext } from 'react';

export interface ScreenState {
  chatsView: boolean;
  outpostOpen: boolean;
  settingsOpen: boolean;
  activeId: string | null;
}

export function onScreenChatId(screen: ScreenState): string | null {
  if (!screen.chatsView || screen.outpostOpen || screen.settingsOpen) return null;
  return screen.activeId;
}

export const OnScreenChat = createContext<string | null>(null);

export function useChatOnScreen(chatId: string): boolean {
  return useContext(OnScreenChat) === chatId;
}
