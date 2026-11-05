import { useEffect, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useReportViewedChats, useViewedChats } from '../desktop/use-viewed-chats.ts';
import { useCloseSeenNotifications } from '../phone/close-seen-notifications.ts';
import { useMarkSeen } from './use-mark-seen.ts';

const shownNow = () => document.visibilityState === 'visible' && document.hasFocus();
const NONE: ReadonlySet<string> = new Set();

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

function useChatsViewed(chatIds: readonly string[]): ReadonlySet<string> {
  useReportViewedChats(chatIds);
  const viewed = useViewedChats();
  const shown = usePageShown();
  if (chatIds.length === 0) return NONE;
  if (sparkDesktop()?.viewing) return new Set(chatIds.filter((id) => viewed.has(id)));
  return shown ? new Set(chatIds) : NONE;
}

export function useSeenChats(
  onScreenIds: readonly string[],
  chats: readonly ConversationSummary[],
  remote: boolean,
): void {
  const viewed = useChatsViewed(onScreenIds);
  const [first = null, second = null] = onScreenIds.filter((id) => viewed.has(id));
  useMarkSeen(first, chats);
  useMarkSeen(second, chats);
  useCloseSeenNotifications(remote, chats, first);
  useCloseSeenNotifications(remote, chats, second);
}
