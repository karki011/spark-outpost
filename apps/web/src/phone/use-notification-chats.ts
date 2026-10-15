import { useEffect } from 'react';
import { registerServiceWorker } from './push-browser.ts';

const CHAT_PARAM = 'chat';
const OPEN_CHAT = 'spark-open-chat';
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function takeChatParam(): string | null {
  const url = new URL(window.location.href);
  const chat = url.searchParams.get(CHAT_PARAM);
  if (chat === null) return null;
  url.searchParams.delete(CHAT_PARAM);
  window.history.replaceState(window.history.state, '', url);
  return CHAT_ID.test(chat) ? chat : null;
}

export function chatOfMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, chatId } = data as { type?: unknown; chatId?: unknown };
  return type === OPEN_CHAT && typeof chatId === 'string' && CHAT_ID.test(chatId) ? chatId : null;
}

export function useNotificationChats(remote: boolean, open: (chatId: string) => void): void {
  useEffect(() => {
    if (!remote || !('serviceWorker' in navigator)) return;
    registerServiceWorker().catch(() => undefined);
    const fromAddress = takeChatParam();
    if (fromAddress) open(fromAddress);
    const onMessage = (event: MessageEvent) => {
      const chatId = chatOfMessage(event.data);
      if (chatId) open(chatId);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [remote, open]);
}
