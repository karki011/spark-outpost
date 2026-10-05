import type { ClipboardEvent } from 'react';
import { chatIdFromLink, isSlackMessageUrl } from '@spark-outpost/contracts';
import type { AttachmentsState } from './use-attachments.ts';

export const OWN_CHAT_NOTICE =
  'That link is this chat. Paste it into a different chat to share this one.';

export function pasteContext(
  event: ClipboardEvent<HTMLTextAreaElement>,
  attachments: AttachmentsState,
  conversationId: string,
): void {
  const files = Array.from(event.clipboardData.files);
  const pasted = event.clipboardData.getData('text/plain').trim();
  const chatId = chatIdFromLink(pasted);
  if (files.length === 0 && !chatId && !isSlackMessageUrl(pasted)) return;
  event.preventDefault();
  if (files.length > 0) attachments.add(files);
  else if (chatId === conversationId) attachments.notify(OWN_CHAT_NOTICE);
  else if (chatId) attachments.addChat(chatId);
  else attachments.addSlack(pasted);
}
