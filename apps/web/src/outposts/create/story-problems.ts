import { storyProblems } from '@spark-outpost/contracts';
import { listedChats, memberId, type ChatDraft, type CreateDraft } from './create-draft.ts';
import { isLead, parentOf } from './story-draft.ts';

export interface StoryIssue {
  field: 'after' | 'message';
  message: string;
}

export const LEAD_GETS_NO_MESSAGE =
  'The chat that proposed this draft cannot get a first message from itself.';
export const LEAD_MISSING = 'Add the chat that proposed this draft';

function hasMessage(chat: ChatDraft): boolean {
  return chat.text.trim() !== '';
}

function cycleOf(draft: CreateDraft, chat: ChatDraft): string | null {
  const edges = listedChats(draft)
    .filter((other) => other.handle !== '')
    .map((other) => {
      const parent = parentOf(draft, other);
      return { handle: other.handle, ...(parent ? { dependsOn: parent.handle } : {}) };
    });
  const cycle = storyProblems(edges).find(
    (problem) => problem.kind === 'cycle' && problem.handle === chat.handle,
  );
  return cycle ? `These chats wait for each other: ${cycle.text}.` : null;
}

function afterIssue(draft: CreateDraft, chat: ChatDraft): string | null {
  const parent = parentOf(draft, chat);
  if (parent === null) return null;
  if (!hasMessage(chat)) {
    return `@${chat.handle} needs a first message to start after @${parent.handle}.`;
  }
  if (!hasMessage(parent)) {
    return `@${parent.handle} has no first message, so nothing can start after it.`;
  }
  return cycleOf(draft, chat);
}

export function storyIssues(chat: ChatDraft, draft: CreateDraft): StoryIssue[] {
  if (draft.origin === undefined) return [];
  if (isLead(draft, chat)) {
    return hasMessage(chat) ? [{ field: 'message', message: LEAD_GETS_NO_MESSAGE }] : [];
  }
  const after = afterIssue(draft, chat);
  return after === null ? [] : [{ field: 'after', message: after }];
}

export function leadMissing(draft: CreateDraft): boolean {
  const lead = draft.origin?.leadChatId;
  if (lead === undefined) return false;
  if (draft.into?.members.some((member) => member.conversationId === lead)) return false;
  return !listedChats(draft).some((chat) => memberId(chat) === lead);
}
