import { useEffect } from 'react';
import { registerServiceWorker } from './push-browser.ts';

const CHAT_PARAM = 'chat';
const CARD_PARAM = 'card';
const OPEN_CHAT = 'spark-open-chat';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface NotificationTarget {
  chatId: string;
  cardId: string | null;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function targetOf(chatId: unknown, cardId: unknown): NotificationTarget | null {
  if (!validId(chatId)) return null;
  return { chatId, cardId: validId(cardId) ? cardId : null };
}

export function takeChatParam(): NotificationTarget | null {
  const url = new URL(window.location.href);
  const chat = url.searchParams.get(CHAT_PARAM);
  const card = url.searchParams.get(CARD_PARAM);
  if (chat === null && card === null) return null;
  url.searchParams.delete(CHAT_PARAM);
  url.searchParams.delete(CARD_PARAM);
  window.history.replaceState(window.history.state, '', url);
  return targetOf(chat, card);
}

export function targetOfMessage(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== 'object') return null;
  const { type, chatId, cardId } = data as { type?: unknown; chatId?: unknown; cardId?: unknown };
  return type === OPEN_CHAT ? targetOf(chatId, cardId) : null;
}

export function useNotificationChats(
  remote: boolean,
  open: (chatId: string, cardId: string | null) => void,
): void {
  useEffect(() => {
    if (!remote || !('serviceWorker' in navigator)) return;
    registerServiceWorker().catch(() => undefined);
    const fromAddress = takeChatParam();
    if (fromAddress) open(fromAddress.chatId, fromAddress.cardId);
    const onMessage = (event: MessageEvent) => {
      const target = targetOfMessage(event.data);
      if (target) open(target.chatId, target.cardId);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [remote, open]);
}
