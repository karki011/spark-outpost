import {
  autonomyLabel,
  isStacked,
  type ConversationSummary,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { listedChats, memberId, type ChatDraft, type CreateDraft } from './create-draft.ts';

export const NO_PARENT = 'none';

export interface AfterChoice {
  key: string;
  handle: string;
}

export function isLead(draft: CreateDraft, chat: ChatDraft): boolean {
  return draft.origin !== undefined && memberId(chat) === draft.origin.leadChatId;
}

export function parentOf(draft: CreateDraft, chat: ChatDraft): ChatDraft | null {
  if (draft.origin === undefined || chat.dependsOn === null) return null;
  return listedChats(draft).find((other) => other.key === chat.dependsOn) ?? null;
}

export function afterChoices(draft: CreateDraft, chat: ChatDraft): AfterChoice[] | null {
  if (draft.origin === undefined || isLead(draft, chat)) return null;
  return listedChats(draft)
    .filter((other) => other.key !== chat.key && other.handle !== '' && !isLead(draft, other))
    .map((other) => ({ key: other.key, handle: other.handle }));
}

function projectOf(chat: ChatDraft, chats: readonly ConversationSummary[]): string | null {
  if (chat.kind === 'new') return chat.projectId;
  return chats.find((candidate) => candidate.id === chat.chatId)?.projectIds[0] ?? null;
}

export function stackParent(
  draft: CreateDraft,
  chat: ChatDraft,
  chats: readonly ConversationSummary[],
): ChatDraft | null {
  const parent = parentOf(draft, chat);
  if (parent === null) return null;
  const stacked = isStacked(
    { projectId: projectOf(chat, chats) },
    { projectId: projectOf(parent, chats) },
  );
  return stacked ? parent : null;
}

export function orderLine(
  draft: CreateDraft,
  chat: ChatDraft,
  chats: readonly ConversationSummary[],
): string {
  const parent = parentOf(draft, chat);
  if (parent === null) return 'Starts right away';
  const after = `Starts after @${parent.handle}`;
  return stackParent(draft, chat, chats) === null
    ? `${after} · different repo, order only`
    : `${after} · stacked on its branch`;
}

export interface PublishFacts {
  chats: readonly ConversationSummary[];
  level: InvolvementLevel;
  readsOnly: (chat: ChatDraft) => boolean;
}

export const READ_ONLY_PULL = 'No pull request in a read-only mode';

export function levelOf(chat: ChatDraft, fallback: InvolvementLevel): InvolvementLevel {
  return chat.level ?? fallback;
}

export function pullLabel(level: InvolvementLevel, stackedOn: string | null): string {
  if (level !== 'full-auto') return 'No pull request';
  return stackedOn === null ? 'Pull request, parallel' : `Pull request, stacked on @${stackedOn}`;
}

export function pullHint(level: InvolvementLevel, stackedOn: string | null): string {
  const autonomy = autonomyLabel(level);
  if (level !== 'full-auto') return `${autonomy}: keeps the changes on its branch`;
  return stackedOn === null
    ? `${autonomy}: targets the default branch`
    : `${autonomy}: targets @${stackedOn}'s branch`;
}

function publishes(chat: ChatDraft, facts: PublishFacts): boolean {
  return !facts.readsOnly(chat) && levelOf(chat, facts.level) === 'full-auto';
}

export function pullLine(draft: CreateDraft, chat: ChatDraft, facts: PublishFacts): string | null {
  if (chat.kind !== 'new') return null;
  if (facts.readsOnly(chat)) return READ_ONLY_PULL;
  const stackedOn = stackParent(draft, chat, facts.chats)?.handle ?? null;
  return pullLabel(levelOf(chat, facts.level), stackedOn);
}

export function unpushedParent(
  draft: CreateDraft,
  chat: ChatDraft,
  facts: PublishFacts,
): string | null {
  const parent = stackParent(draft, chat, facts.chats);
  if (parent === null || chat.kind !== 'new' || parent.kind !== 'new') return null;
  if (!publishes(chat, facts) || publishes(parent, facts)) return null;
  return `@${parent.handle} opens no pull request, so @${chat.handle} cannot push until @${parent.handle}'s branch is pushed.`;
}

export function leadHandle(draft: CreateDraft): string | null {
  const lead = draft.origin?.leadChatId;
  if (lead === undefined) return null;
  const joined = draft.into?.members.find((member) => member.conversationId === lead);
  const listed = listedChats(draft).find((chat) => memberId(chat) === lead);
  return joined?.handle ?? listed?.handle ?? null;
}

export function storyStartLines(draft: CreateDraft): string[] {
  if (draft.origin === undefined) return [];
  const lead = leadHandle(draft);
  const waits = listedChats(draft).some((chat) => parentOf(draft, chat) !== null);
  return [
    lead === null
      ? "First messages are sent as the proposing chat's, not yours."
      : `First messages are sent as @${lead}'s, not yours.`,
    waits ? 'A chat that starts after another waits until that one has answered.' : null,
    "Each chat's own autonomy decides whether it opens a pull request.",
  ].filter((line): line is string => line !== null);
}
