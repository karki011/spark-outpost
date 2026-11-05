import type { QueryClient } from '@tanstack/react-query';
import {
  friendlyStep,
  type AppEvent,
  type ConversationDetail,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { queryKeys } from '../../api/client.ts';

function withStep(chat: ConversationSummary, runId: string, step: string): ConversationSummary {
  const run = chat.latestRun;
  if (!run || run.id !== runId || run.status !== 'running' || run.step === step) return chat;
  return { ...chat, latestRun: { ...run, step } };
}

export function patchRunStep(client: QueryClient, event: AppEvent): void {
  const { kind, step, conversationId, runId } = event;
  if (kind !== 'step' || step === undefined || !conversationId || !runId) return;
  const shown = friendlyStep(step);
  client.setQueryData<ConversationSummary[]>(queryKeys.conversations, (list) => {
    const row = list?.find((chat) => chat.id === conversationId);
    if (!list || !row) return list;
    const next = withStep(row, runId, shown);
    return next === row ? list : list.map((chat) => (chat === row ? next : chat));
  });
  client.setQueryData<ConversationDetail>(queryKeys.conversation(conversationId), (detail) => {
    if (!detail) return detail;
    const next = withStep(detail.conversation, runId, shown);
    return next === detail.conversation ? detail : { ...detail, conversation: next };
  });
}
