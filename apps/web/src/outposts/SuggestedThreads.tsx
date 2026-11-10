import { useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatDraft, OutpostSuggestions } from '@spark-outpost/contracts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { ChatDraftLine } from '../chat/outpost/TurnOutpostLines.tsx';
import { MemberFace } from './MemberFace.tsx';
import type { MemberView } from './member-view.ts';
import { outpostKeys, outpostsApi } from './outposts-api.ts';

interface SuggestedThreadsProps {
  outpostId: string;
  members: readonly MemberView[];
}

interface Suggestion {
  member: MemberView;
  draft: ChatDraft;
}

export function suggestionsOf(
  members: readonly MemberView[],
  suggested: OutpostSuggestions | undefined,
): Suggestion[] {
  const byChat = new Map(members.map((member) => [member.conversationId, member]));
  return (suggested?.drafts ?? []).flatMap(({ conversationId, ...draft }) => {
    const member = byChat.get(conversationId);
    return member ? [{ member, draft }] : [];
  });
}

export function SuggestedThreads({ outpostId, members }: SuggestedThreadsProps) {
  const seam = useOutpostSeam();
  const headingId = useId();
  const { data } = useQuery({
    queryKey: outpostKeys.suggestions(outpostId),
    queryFn: () => outpostsApi.suggestions(outpostId),
  });
  const suggestions = useMemo(() => suggestionsOf(members, data), [members, data]);
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
