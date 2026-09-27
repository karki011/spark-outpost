import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { lastDecisionLine, pendingAsks } from './tv-scene.ts';

interface AgentTvHostProps {
  activeId: string | null;
  onGoTo(conversationId: string): void;
}

export function AgentTvHost({ activeId, onGoTo }: AgentTvHostProps) {
  const { sourceId } = useAgentTv();
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
  const idle = busyCount(agents) === 0 && !waiting;

  useEffect(() => {
    if (elsewhere && idle && source) closeAgentTv();
  }, [elsewhere, idle, source]);

  if (!sourceId || !orchestration || agents.length === 0) return null;

  const jump = (anchor: string) => {
    if (elsewhere) onGoTo(sourceId);
    scrollToAnchor(anchor);
  };

  return (
    <AgentTv
      members={agents}
      asks={pendingAsks(source, orchestration, agents)}
      decision={lastDecisionLine(orchestration)}
      onPick={(agentId) => jump(agentAnchor(orchestration.runId, agentId))}
      onAsk={(approvalId) => jump(approvalAnchor(approvalId))}
    />
  );
}
