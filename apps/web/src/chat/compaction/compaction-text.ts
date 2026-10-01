import type { Compaction } from '@spark-outpost/contracts';
import { formatTokens } from '../composer/model-options.ts';

export function compactionTitle(compaction: Compaction): string {
  if (compaction.fromConversationId) {
    return compaction.fromTitle
      ? `Started from a summary of ${compaction.fromTitle}`
      : 'Started from a summary of an earlier chat';
  }
  if (compaction.method === 'agent-auto') return 'The agent compacted its context';
  if (compaction.method === 'spark') return 'Compacted with a Spark summary';
  return 'Compacted';
}

export function tokensLine(compaction: Compaction): string | null {
  const before = compaction.tokensBefore;
  const after = compaction.tokensAfter;
  if (before === null) return null;
  if (after === null) return `${formatTokens(before)} tokens before`;
  return `${formatTokens(before)} → ${formatTokens(after)} tokens`;
}

export function compactionsByRun(
  compactions: readonly Compaction[] | undefined,
): Map<string, Compaction[]> {
  const byRun = new Map<string, Compaction[]>();
  for (const compaction of compactions ?? []) {
    if (!compaction.runId) continue;
    byRun.set(compaction.runId, [...(byRun.get(compaction.runId) ?? []), compaction]);
  }
  return byRun;
}
