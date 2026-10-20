import { useEffect, useState } from 'react';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useReportViewedChat, useViewedChats } from '../desktop/use-viewed-chats.ts';

const shownNow = () => document.visibilityState === 'visible' && document.hasFocus();

function usePageShown(): boolean {
  const [shown, setShown] = useState(shownNow);
  useEffect(() => {
    const changed = () => setShown(shownNow());
    window.addEventListener('focus', changed);
    window.addEventListener('blur', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      window.removeEventListener('focus', changed);
      window.removeEventListener('blur', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, []);
  return shown;
}

export function useChatViewed(chatId: string | null): boolean {
  useReportViewedChat(chatId);
  const viewed = useViewedChats();
  const shown = usePageShown();
  if (!chatId) return false;
  return sparkDesktop()?.viewing ? viewed.has(chatId) : shown;
}
