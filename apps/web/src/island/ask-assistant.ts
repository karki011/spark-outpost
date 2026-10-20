import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Approval, ConversationDetail } from '@spark-outpost/contracts';
import { assistantApi, assistantKeys } from '../api/assistant.ts';
import { api, queryKeys } from '../api/client.ts';
import { islandApi, islandKeys } from './island-api.ts';

export const assistantQuery = queryOptions({
  queryKey: islandKeys.assistant,
  queryFn: islandApi.assistant,
  staleTime: Infinity,
});

export function useAssistant() {
  const id = useQuery(assistantQuery);
  const detail = useQuery({
    queryKey: queryKeys.conversation(id.data ?? 'none'),
    queryFn: () => api.getConversation(id.data!),
    enabled: id.data !== undefined,
  });
  return { id: id.data ?? null, error: id.error, detail: detail.data };
}

export function assistantCards(detail: ConversationDetail | undefined) {
  const byRun = new Map<string, Approval[]>();
  for (const approval of detail?.approvals ?? []) {
    if (!approval.payload.sparkAction) continue;
    byRun.set(approval.runId, [...(byRun.get(approval.runId) ?? []), approval]);
  }
  return byRun;
}

function waitingAssistantCards(detail: ConversationDetail | undefined): Approval[] {
  return (detail?.approvals ?? []).filter(
    (approval) => approval.payload.sparkAction !== undefined && approval.status === 'pending',
  );
}

export function useAssistantInbox() {
  const view = useQuery({ queryKey: assistantKeys.settings, queryFn: assistantApi.settings });
  const id = view.data?.conversationId ?? null;
  const detail = useQuery({
    queryKey: queryKeys.conversation(id ?? 'none'),
    queryFn: () => api.getConversation(id!),
    enabled: id !== null,
  });
  return useMemo(
    () => ({ conversationId: id, cards: waitingAssistantCards(detail.data) }),
    [id, detail.data],
  );
}
