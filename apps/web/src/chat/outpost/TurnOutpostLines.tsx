import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { outpostKeys, outpostsApi } from '../../outposts/outposts-api.ts';
import { chatDraftsQuery } from './chat-drafts.ts';
import { draftsInTurn, sentInTurn, type TurnWindow } from './chat-lines.ts';
import { DraftLine } from './DraftLine.tsx';
import { useOutpostSeam, type OutpostSeam } from './outpost-seam.ts';
import { SentLine } from './SentLine.tsx';

interface SentLinesProps {
  outpostId: string;
  chatId: string;
  run: TurnWindow;
  seam: OutpostSeam | null;
}

function SentLines({ outpostId, chatId, run, seam }: SentLinesProps) {
  const sent = useQuery({
    queryKey: outpostKeys.detail(outpostId),
    queryFn: () => outpostsApi.get(outpostId),
    select: (detail) => sentInTurn(detail.posts, chatId, run),
    notifyOnChangeProps: ['data'],
  });
  return (sent.data ?? []).map((post) => (
    <SentLine
      key={post.id}
      post={post}
      onOpen={seam ? () => seam.onOpenOutpost(outpostId, post.id) : undefined}
    />
  ));
}

interface DraftLinesProps {
  chatId: string;
  runId: string;
  seam: OutpostSeam;
  onOpenDraft: (draftId: string) => void;
}

function DraftLines({ chatId, runId, seam, onOpenDraft }: DraftLinesProps) {
  const drafts = useQuery({
    ...chatDraftsQuery(chatId),
    select: (list) => draftsInTurn(list.drafts, runId),
    notifyOnChangeProps: ['data'],
  });
  return (drafts.data ?? []).map((draft) => {
    const outpostId = draft.outpostId;
    const outpost = seam.outposts.find((listed) => listed.id === outpostId);
    return (
      <DraftLine
        key={draft.id}
        draft={draft}
        outpostName={outpost?.name}
        onReview={seam.canManage ? () => onOpenDraft(draft.id) : undefined}
        onOpenOutpost={outpostId && outpost ? () => seam.onOpenOutpost(outpostId) : undefined}
      />
    );
  });
}

interface TurnOutpostLinesProps {
  conversation: Pick<ConversationSummary, 'id' | 'outpost'>;
  run: TurnWindow;
}

export function TurnOutpostLines({ conversation, run }: TurnOutpostLinesProps) {
  const seam = useOutpostSeam();
  const outpostId = conversation.outpost?.id;
  const onOpenDraft = seam?.onOpenDraft;
  return (
    <>
      {seam && onOpenDraft && !run.parentRunId && (
        <DraftLines chatId={conversation.id} runId={run.id} seam={seam} onOpenDraft={onOpenDraft} />
      )}
      {outpostId && !run.parentRunId && (
        <SentLines outpostId={outpostId} chatId={conversation.id} run={run} seam={seam} />
      )}
    </>
  );
}
