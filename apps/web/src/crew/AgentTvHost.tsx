import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { closeAgentTv, useAgentTv } from './agent-tv-store.ts';
import { AgentTv } from './AgentTv.tsx';
import {
  agentAnchor,
  approvalAnchor,
  conversationCrew,
  crewOrchestration,
} from './conversation-crew.ts';
import { busyCount } from './crew-model.ts';
import { scrollToAnchor } from './scroll-to-anchor.ts';
import { JEV_ID } from './crew-projection.ts';
import { coordinatorScene } from './tv-coordinator.ts';
import { tvListRows } from './tv-list.ts';
import { lastDecisionLine, pendingAsks, spokenDecisionLine } from './tv-scene.ts';

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
  const agents = conversationCrew(source);
  const orchestration = crewOrchestration(source);
  const waiting = orchestration?.pendingCheckpoint ?? null;
  const elsewhere = sourceId !== null && sourceId !== activeId;
  const asking = agents.some((agent) => agent.state === 'waiting');
  const idle = busyCount(agents) === 0 && !waiting && !asking;
  const stop = useMutation({
    mutationFn: api.cancelRun,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(sourceId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]),
  });

  useEffect(() => {
    if (elsewhere && idle && source) closeAgentTv();
  }, [elsewhere, idle, source]);

  if (!sourceId || !orchestration || agents.length === 0) return null;

  const jump = (anchor: string) => {
    if (elsewhere) onGoTo(sourceId);
    scrollToAnchor(anchor);
  };

  const scene = coordinatorScene(orchestration, agents, source?.activity);
  const members = scene?.members ?? agents;
  const asks = pendingAsks(source, orchestration, members);
  const runIds = new Set(orchestration.crew.map((member) => member.runId));
  const anchored = (agentId: string) => (runIds.has(agentId) ? agentId : JEV_ID);

  return (
    <AgentTv
      members={members}
      asks={asks}
      tags={scene?.tags ?? null}
      rows={tvListRows(source, orchestration, members, asks)}
      stopping={stop.isPending ? (stop.variables ?? null) : null}
      onStop={(runId) => stop.mutate(runId)}
      decision={lastDecisionLine(orchestration)}
      remark={spokenDecisionLine(orchestration)}
      branch={source?.conversation.branch ?? null}
      onPick={(agentId) => jump(agentAnchor(orchestration.runId, anchored(agentId)))}
      onAsk={(approvalId) => jump(approvalAnchor(approvalId))}
    />
  );
}
