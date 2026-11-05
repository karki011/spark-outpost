import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { chatShareApi } from '../api/chat-share.ts';
import '../ui/toast.css';

const NOTICE_MS = 4000;

export const CHAT_LINK_COPIED = 'Chat link copied. Paste it into another chat to share this one.';
export const CHAT_LINK_FAILED = 'Could not copy the chat link. Try again.';

export async function copyChatLink(chatId: string): Promise<string> {
  try {
    const { link } = await chatShareApi.link(chatId);
    await navigator.clipboard.writeText(link);
    return CHAT_LINK_COPIED;
  } catch {
    return CHAT_LINK_FAILED;
  }
}

export function useCopyChatLink(chatId: string) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return {
    copy: () => void copyChatLink(chatId).then(setNotice),
    toast: notice
      ? createPortal(
          <div className="toast floating" role="status">
            <span>{notice}</span>
          </div>,
          document.body,
        )
      : null,
  };
}
