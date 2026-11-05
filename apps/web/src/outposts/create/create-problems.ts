import {
  OUTPOST_MEMBERS_MAX,
  OUTPOST_NAME_MAX,
  handleProblem,
  suggestHandle,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';
import { joinedHandles, listedChats, type ChatDraft, type CreateDraft } from './create-draft.ts';
import { LEAD_MISSING, leadMissing, storyIssues } from './story-problems.ts';

export type ChatField = 'chat' | 'project' | 'agent' | 'handle' | 'message' | 'after';

export interface ChatProblem {
  key: string;
  field: ChatField;
  message: string;
  suggestions: string[];
}

export const TERMINAL_CANNOT_JOIN =
  'A Terminal session cannot join. Spark cannot send it a request.';

export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if (trimmed.length > OUTPOST_NAME_MAX) {
    return `A name can have at most ${OUTPOST_NAME_MAX} characters.`;
  }
  return null;
}

export function joinBlock(chat: ConversationSummary): string | null {
  if (chat.sessionType === 'terminal') return TERMINAL_CANNOT_JOIN;
  if (chat.outpost) return `Already in ${chat.outpost.name}. A chat belongs to one outpost.`;
  return null;
}

function problem(
  chat: ChatDraft,
  field: ChatField,
  message: string,
  suggestions: string[] = [],
): ChatProblem {
  return { key: chat.key, field, message, suggestions };
}

function memberProblem(chat: ChatDraft, chats: readonly ConversationSummary[]): ChatProblem | null {
  if (chat.kind === 'new') {
    if (chat.projectId === null) return problem(chat, 'project', 'A new chat needs a project.');
    if (chat.provider === null)
      return problem(chat, 'agent', 'Connect an agent in Settings first.');
    return null;
  }
  if (chat.chatId === null) return problem(chat, 'chat', 'Choose a chat.');
  const picked = chats.find((candidate) => candidate.id === chat.chatId);
  if (!picked) return problem(chat, 'chat', 'This chat no longer exists. Remove it.');
  const blocked = joinBlock(picked);
  return blocked ? problem(chat, 'chat', blocked) : null;
}

function handleSuggestions(
  chat: ChatDraft,
  title: string | undefined,
  taken: readonly string[],
): string[] {
  const numbered = suggestHandle(chat.handle, taken);
  if (title === undefined) return [numbered];
  const named = suggestHandle(title, taken);
  return named.startsWith(chat.handle) ? [numbered] : [numbered, named];
}

function handleIssue(
  chat: ChatDraft,
  draft: CreateDraft,
  chats: readonly ConversationSummary[],
): ChatProblem | null {
  const listed = listedChats(draft);
  const before = listed.slice(0, listed.indexOf(chat)).map((other) => other.handle);
  const earlier = [...joinedHandles(draft), ...before];
  const shape = handleProblem(chat.handle, []);
  if (shape) return problem(chat, 'handle', shape);
  if (!earlier.includes(chat.handle)) return null;
  const title =
    chat.kind === 'existing'
      ? chats.find((candidate) => candidate.id === chat.chatId)?.title
      : undefined;
  const taken = [...joinedHandles(draft), ...listed.map((other) => other.handle)];
  return problem(
    chat,
    'handle',
    `Two chats cannot share @${chat.handle}.`,
    handleSuggestions(chat, title, taken),
  );
}

function messageProblem(chat: ChatDraft): ChatProblem | null {
  if (chat.filesPending) {
    return problem(
      chat,
      'message',
      'A file is still uploading or failed. Wait, retry or remove it.',
    );
  }
  if (chat.files.length > 0 && chat.text.trim() === '') {
    return problem(chat, 'message', 'Write the message, or remove its files.');
  }
  return null;
}

export function chatProblems(
  chat: ChatDraft,
  draft: CreateDraft,
  chats: readonly ConversationSummary[],
): ChatProblem[] {
  if (!chat.touched) return [];
  const member = memberProblem(chat, chats);
  const picked = member === null || chat.kind === 'new';
  const message = messageProblem(chat);
  const story = storyIssues(chat, draft)
    .filter((issue) => issue.field !== 'message' || message === null)
    .map((issue) => problem(chat, issue.field, issue.message));
  return [member, picked ? handleIssue(chat, draft, chats) : null, message, ...story].filter(
    (found): found is ChatProblem => found !== null,
  );
}

export function draftProblems(
  draft: CreateDraft,
  chats: readonly ConversationSummary[],
): ChatProblem[] {
  return listedChats(draft).flatMap((chat) => chatProblems(chat, draft, chats));
}

export function isFinished(
  chat: ChatDraft,
  draft: CreateDraft,
  chats: readonly ConversationSummary[],
): boolean {
  return chat.touched && chatProblems(chat, draft, chats).length === 0;
}

export function continueBlock(
  draft: CreateDraft,
  chats: readonly ConversationSummary[],
): string | null {
  if (listedChats(draft).length > OUTPOST_MEMBERS_MAX) {
    return `An outpost can have at most ${OUTPOST_MEMBERS_MAX} chats.`;
  }
  const count = draftProblems(draft, chats).length;
  if (count > 0) return `${countLabel(count, 'thing')} to fix`;
  return leadMissing(draft) ? LEAD_MISSING : null;
}
