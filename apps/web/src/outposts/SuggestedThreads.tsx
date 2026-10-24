import { useId } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ChatDraft } from '@spark-outpost/contracts';
import { chatDraftsQuery } from '../chat/outpost/chat-drafts.ts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { ChatDraftLine } from '../chat/outpost/TurnOutpostLines.tsx';
import { MemberFace } from './MemberFace.tsx';
import type { MemberView } from './member-view.ts';

interface SuggestedThreadsProps {
  outpostId: string;
  members: readonly MemberView[];
}

interface Suggestion {
  member: MemberView;
  draft: ChatDraft;
}

export function openSuggestions(
  outpostId: string,
  members: readonly MemberView[],
  lists: readonly (readonly ChatDraft[] | undefined)[],
): Suggestion[] {
  return members.flatMap((member, index) =>
    (lists[index] ?? [])
      .filter((draft) => draft.startedAt === null)
      .filter((draft) => draft.outpostId === null || draft.outpostId === outpostId)
      .map((draft) => ({ member, draft })),
  );
}

export function SuggestedThreads({ outpostId, members }: SuggestedThreadsProps) {
  const seam = useOutpostSeam();
  const headingId = useId();
  const lists = useQueries({
    queries: members.map((member) => chatDraftsQuery(member.conversationId)),
  });
  const suggestions = openSuggestions(
    outpostId,
    members,
    lists.map((list) => list.data?.drafts),
  );
  const onOpenDraft = seam?.onOpenDraft;
  if (!seam || !onOpenDraft || suggestions.length === 0) return null;
  return (
    <div className="op-suggested" role="region" aria-labelledby={headingId}>
      <h3 id={headingId}>Suggested threads</h3>
      <p className="op-suggested-note">
        Proposed by a chat. Nothing starts until you start it, and the proposal is never your
        message.
      </p>
      <ul>
        {suggestions.map(({ member, draft }) => (
          <li key={draft.id}>
            <MemberFace chatId={member.conversationId} size="row" />
            <b className="op-suggested-from">@{member.handle}</b>
            <ChatDraftLine
              chatId={member.conversationId}
              draft={draft}
              seam={seam}
              onOpenDraft={onOpenDraft}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
