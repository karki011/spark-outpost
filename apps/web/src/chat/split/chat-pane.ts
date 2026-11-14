import { createContext, useContext, type ReactNode } from 'react';

export interface ChatPane {
  split: boolean;
  focused: boolean;
  idSuffix: string;
  name: string | null;
  landmark: 'main' | 'section';
  closer: ReactNode;
  intro?: string;
  crewChat?: boolean;
}

export const SINGLE_PANE: ChatPane = {
  split: false,
  focused: true,
  idSuffix: '',
  name: null,
  landmark: 'main',
  closer: null,
};

export const ChatPaneContext = createContext<ChatPane>(SINGLE_PANE);

export function useChatPane(): ChatPane {
  return useContext(ChatPaneContext);
}

export function usePaneFocused(): boolean {
  return useContext(ChatPaneContext).focused;
}

export function useInSplit(): boolean {
  return useContext(ChatPaneContext).split;
}

export function usePaneId(base: string): string {
  return base + useContext(ChatPaneContext).idSuffix;
}

export function paneLabel(pane: ChatPane, title: string): string | undefined {
  if (pane.name === null) return undefined;
  const chat = title.trim() || 'New chat';
  return pane.focused ? `${pane.name}: ${chat}, focused` : `${pane.name}: ${chat}`;
}
