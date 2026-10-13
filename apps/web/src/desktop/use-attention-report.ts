import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  attentionReport,
  type AttentionReport,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { sparkDesktop } from './desktop-bridge.ts';

export function useAttentionReport(chats: readonly ConversationSummary[] | undefined): void {
  const report = chats ? JSON.stringify(attentionReport(chats)) : null;
  useEffect(() => {
    if (report === null) return;
    sparkDesktop()?.attention?.report(JSON.parse(report) as AttentionReport);
  }, [report]);
}

export function useChatListAttentionReport(): void {
  const list = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  useAttentionReport(list.data);
}
