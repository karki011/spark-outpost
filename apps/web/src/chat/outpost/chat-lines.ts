import type { OutpostPost, Run } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';
import type { ChatDraft } from './chat-drafts.ts';

export type TurnWindow = Pick<Run, 'id'> & { parentRunId?: Run['parentRunId'] };

export function sentInTurn(
  posts: readonly OutpostPost[],
  chatId: string,
  run: TurnWindow,
): OutpostPost[] {
  if (run.parentRunId) return [];
  return posts.filter(
    (post) =>
      post.kind === 'request' &&
      !post.fromUser &&
      post.fromConversationId === chatId &&
      post.fromRunId === run.id,
  );
}

export function draftsInTurn(drafts: readonly ChatDraft[], runId: string): ChatDraft[] {
  return drafts.filter((draft) => draft.runId === runId);
}

export function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

export function draftLabel(draft: Pick<ChatDraft, 'chats' | 'stacked' | 'startedAt'>): string {
  const verb = draft.startedAt ? 'Started' : 'Proposed';
  const chats = `${verb} ${countLabel(draft.chats, 'chat')}`;
  return draft.stacked > 0 ? `${chats} · ${draft.stacked} stacked` : chats;
}
