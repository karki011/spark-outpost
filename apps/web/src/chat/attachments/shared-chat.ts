import {
  chatShareState,
  chatShareStateLabels,
  type ChatSharePreview,
  type ChatShareState,
  type ConversationSummary,
} from '@spark-outpost/contracts';

export type SharedChatTone = ChatShareState | 'archived' | 'deleted';

export interface SharedChatView {
  title: string;
  project: string;
  tone: SharedChatTone;
  state: string;
}

export const NO_PROJECT_LABEL = 'No project';

export function projectLabel(names: readonly string[]): string {
  return names.join(', ') || NO_PROJECT_LABEL;
}

function toneLabel(tone: SharedChatTone): string {
  if (tone === 'archived') return 'Archived';
  if (tone === 'deleted') return 'Deleted';
  return chatShareStateLabels[tone];
}

export function sharedChatView(
  preview: ChatSharePreview,
  chats: readonly ConversationSummary[] | undefined,
): SharedChatView {
  const live = chats?.find((chat) => chat.id === preview.id);
  const tone: SharedChatTone =
    chats && !live
      ? 'deleted'
      : (live ? live.archivedAt !== null : preview.archived)
        ? 'archived'
        : live
          ? chatShareState(live)
          : preview.state;
  return {
    title: live?.title ?? preview.title,
    project: projectLabel(preview.projects),
    tone,
    state: toneLabel(tone),
  };
}

export function summaryChatView(
  chat: ConversationSummary,
  projectNames: readonly string[],
): SharedChatView {
  const tone = chatShareState(chat);
  return { title: chat.title, project: projectLabel(projectNames), tone, state: toneLabel(tone) };
}
