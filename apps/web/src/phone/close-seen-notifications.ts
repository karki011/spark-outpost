import { useEffect } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { unseenSince } from '../conversations/chat-blob.ts';

const CHAT_TAG = /^spark-chat-([0-9a-f-]{36})$/;

export function seenNotification(
  tag: string,
  chats: readonly ConversationSummary[],
  viewedChat: string | null,
): boolean {
  const chatId = CHAT_TAG.exec(tag)?.[1];
  if (!chatId) return false;
  if (chatId === viewedChat) return true;
  const chat = chats.find((each) => each.id === chatId);
  return chat !== undefined && unseenSince(chat) === null;
}

async function closeSeen(chats: readonly ConversationSummary[], viewedChat: string | null) {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.getNotifications) return;
  for (const notification of await registration.getNotifications()) {
    if (seenNotification(notification.tag, chats, viewedChat)) notification.close();
  }
}

export function useCloseSeenNotifications(
  remote: boolean,
  chats: readonly ConversationSummary[],
  viewedChat: string | null,
): void {
  useEffect(() => {
    if (!remote || !('serviceWorker' in navigator)) return;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      closeSeen(chats, viewedChat).catch(() => undefined);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [remote, chats, viewedChat]);
}
