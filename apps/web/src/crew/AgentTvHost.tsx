import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { turnAnchor } from '../chat/outline/outline-model.ts';
import { agentPurpose } from '../chat/subagents/agent-cards.ts';
import { closeAgentTv, useAgentTv } from './agent-tv-store.ts';
import { AgentTv } from './AgentTv.tsx';
import { agentAnchor, approvalAnchor, castAgents, tvCast } from './conversation-crew.ts';
import { busyCount } from './crew-model.ts';
import { scrollToAnchor } from './scroll-to-anchor.ts';
import { tvListRows } from './tv-list.ts';
import { pendingAsks } from './tv-scene.ts';
import { outpostKeys, outpostsApi } from '../outposts/outposts-api.ts';
import { queueDraftAfterTyped, requestComposerFocus } from '../chat/composer/pending-draft.ts';

interface AgentTvHostProps {
  activeId: string | null;
  onGoTo(conversationId: string): void;
}

export function AgentTvHost({ activeId, onGoTo }: AgentTvHostProps) {
  const { sourceId } = useAgentTv();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.conversation(sourceId ?? ''),
    queryFn: () => api.getConversation(sourceId!),
    enabled: sourceId !== null,
  });
  const source = sourceId ? detail.data : undefined;
  const outpostId = source?.conversation.outpost?.id;
  const outpost = useQuery({
    queryKey: outpostKeys.detail(outpostId ?? ''),
    queryFn: () => outpostsApi.get(outpostId!),
    enabled: outpostId !== undefined,
  });
  const cast = tvCast(source);
  const members = castAgents(cast);
  const elsewhere = sourceId !== null && sourceId !== activeId;
  const asking = members.some((agent) => agent.state === 'waiting');
  const idle = busyCount(members) === 0 && !asking;
  const stop = useMutation({
    mutationFn: (runId: string) => api.cancelRun(runId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(sourceId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]),
  });

  useEffect(() => {
    if (elsewhere && idle && source) closeAgentTv();
  }, [elsewhere, idle, source]);

  if (!sourceId || !cast) return null;

  const jump = (anchor: string) => {
    if (elsewhere) onGoTo(sourceId);
    scrollToAnchor(anchor);
  };

  const asks = pendingAsks(source, members);
  const message = (conversationId: string, draft?: string) => {
    if (draft) queueDraftAfterTyped(conversationId, draft);
    requestComposerFocus(conversationId);
    closeAgentTv();
    onGoTo(conversationId);
  };
  const anchorOf = (agentId: string) =>
    agentId === cast.run.id ? turnAnchor(cast.run.id) : agentAnchor(cast.run.id, agentId);

  return (
    <AgentTv
      members={members}
      asks={asks}
      rows={tvListRows(cast, asks)}
      stopping={stop.isPending ? (stop.variables ?? null) : null}
      onStop={(runId) => stop.mutate(runId)}
      branch={source?.conversation.branch ?? null}
      subagents={cast.subagents}
      messageChats={[
        { conversationId: sourceId, name: source?.conversation.outpost?.handle ?? 'lead' },
        ...(outpost.data?.outpost.members ?? [])
          .filter((member) => member.conversationId !== sourceId)
          .map((member) => ({ conversationId: member.conversationId, name: member.handle })),
      ]}
      onMessage={(conversationId) => message(conversationId)}
      onRedirect={(row) => {
        const purpose = agentPurpose(row.task, row.name) ?? row.name;
        const topic = purpose.length > 120 ? `${purpose.slice(0, 117)}…` : purpose;
        message(
          sourceId,
          `Please redirect the sub-agent ${row.name} (${row.id}) working on ${topic}: `,
        );
      }}
      onPick={(agentId) => jump(anchorOf(agentId))}
      onAsk={(approvalId) => jump(approvalAnchor(approvalId))}
    />
  );
}
