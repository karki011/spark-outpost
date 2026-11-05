import type { ChatDraft, OutpostPost, Run } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';

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

export function draftLabel(
  draft: Pick<ChatDraft, 'chats' | 'stacked' | 'startedAt'>,
  outpostName?: string | null,
): string {
  const count = countLabel(draft.chats, 'chat');
  const chats = !draft.startedAt
    ? `Proposed ${count}`
    : outpostName
      ? `Started outpost ${outpostName} with ${count}`
      : `Started ${count}`;
  return draft.stacked > 0 ? `${chats} · ${draft.stacked} stacked` : chats;
}
