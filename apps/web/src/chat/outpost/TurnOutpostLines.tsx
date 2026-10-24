import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatDraft, ConversationSummary } from '@spark-outpost/contracts';
import { outpostKeys, outpostsApi } from '../../outposts/outposts-api.ts';
import { startedThread } from '../../outposts/started-thread.ts';
import { chatDraftsQuery } from './chat-drafts.ts';
import { draftsInTurn, sentInTurn, type TurnWindow } from './chat-lines.ts';
import { DraftLine, type DraftStartState } from './DraftLine.tsx';
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

function useStartDraft(
  chatId: string,
  draftId: string,
  onStarted: (outpostId: string, threadId: string | null) => void,
): DraftStartState {
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: () => outpostsApi.startDraft(draftId),
    onSuccess: async ({ outpostId }) => {
      const detail = await client
        .fetchQuery({
          queryKey: outpostKeys.detail(outpostId),
          queryFn: () => outpostsApi.get(outpostId),
          staleTime: 0,
        })
        .catch(() => null);
      onStarted(outpostId, startedThread(detail?.stories ?? [], draftId));
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: chatDraftsQuery(chatId).queryKey }),
        client.invalidateQueries({ queryKey: outpostKeys.all }),
      ]),
  });
  return {
    onStart: () => start.mutate(),
    pending: start.isPending,
    error: start.error?.message ?? null,
  };
}

interface ChatDraftLineProps {
  chatId: string;
  draft: ChatDraft;
  seam: OutpostSeam;
  onOpenDraft: (draftId: string) => void;
}

export function ChatDraftLine({ chatId, draft, seam, onOpenDraft }: ChatDraftLineProps) {
  const start = useStartDraft(chatId, draft.id, (outpostId, threadId) =>
    seam.onOpenOutpost(outpostId, threadId ?? undefined, true),
  );
  const outpostId = draft.outpostId;
  const outpost = seam.outposts.find((listed) => listed.id === outpostId);
  return (
    <DraftLine
      draft={draft}
      outpostName={outpost?.name}
      onReview={seam.canManage ? () => onOpenDraft(draft.id) : undefined}
      start={seam.canManage ? undefined : start}
      onOpenOutpost={outpostId && outpost ? () => seam.onOpenOutpost(outpostId) : undefined}
    />
  );
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
  return (drafts.data ?? []).map((draft) => (
    <ChatDraftLine
      key={draft.id}
      chatId={chatId}
      draft={draft}
      seam={seam}
      onOpenDraft={onOpenDraft}
    />
  ));
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
