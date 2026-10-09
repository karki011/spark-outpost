import {
  clipAtWord,
  type CreateOutpostRequest,
  type FirstMessage,
  type StartMember,
} from '@spark-outpost/contracts';
import { listedChats, type ChatDraft, type CreateDraft } from './create-draft.ts';

const EXCERPT_MAX = 120;

export interface StartSummary {
  chats: number;
  newChats: number;
  firstRequests: number;
}

export function firstMessageOf(chat: ChatDraft): FirstMessage | null {
  const text = chat.text.trim();
  if (text === '') return null;
  return { id: chat.messageId, text, attachmentIds: chat.files.map((file) => file.id) };
}

export function messageExcerpt(chat: ChatDraft): string | null {
  const message = firstMessageOf(chat);
  return message ? clipAtWord(message.text.replace(/\s+/g, ' '), EXCERPT_MAX) : null;
}

function startMember(chat: ChatDraft): StartMember | null {
  const message = firstMessageOf(chat);
  const shared = { handle: chat.handle, ...(message ? { firstMessage: message } : {}) };
  if (chat.kind === 'existing') {
    return chat.chatId === null ? null : { conversationId: chat.chatId, ...shared };
  }
  if (chat.projectId === null || chat.provider === null) return null;
  return {
    new: {
      conversationId: chat.newChatId,
      projectId: chat.projectId,
      provider: chat.provider,
      model: chat.model,
      agentMode: chat.agentMode,
    },
    ...shared,
  };
}

export function buildCreateRequest(outpostId: string, draft: CreateDraft): CreateOutpostRequest {
  return {
    id: outpostId,
    name: draft.name.trim(),
    members: listedChats(draft)
      .map(startMember)
      .filter((member): member is StartMember => member !== null),
  };
}

export function startSummary(draft: CreateDraft): StartSummary {
  const chats = listedChats(draft);
  return {
    chats: chats.length,
    newChats: chats.filter((chat) => chat.kind === 'new').length,
    firstRequests: chats.filter((chat) => firstMessageOf(chat) !== null).length,
  };
}
