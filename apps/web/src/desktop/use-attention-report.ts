import { useEffect } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { attentionReport } from './attention-report.ts';
import { sparkDesktop, type AttentionReport } from './desktop-bridge.ts';

export function useAttentionReport(chats: readonly ConversationSummary[] | undefined): void {
  const report = chats ? JSON.stringify(attentionReport(chats)) : null;
  useEffect(() => {
    if (report === null) return;
    sparkDesktop()?.attention?.report(JSON.parse(report) as AttentionReport);
  }, [report]);
}
