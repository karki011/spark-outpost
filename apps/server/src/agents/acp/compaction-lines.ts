import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';

type CompactionUpdate = Extract<SessionUpdate, { sessionUpdate: 'compaction_update' }>;

export const COMPACTED_LINE = 'Context compacted';
export const COMPACTION_FAILED_LINE = 'Warning: Context compaction failed';

const ENDED = new Set(['completed', 'failed', 'cancelled']);
const ERROR_MAX = 300;

function failedLine(error: string | null | undefined): string {
  const reason = error?.trim().slice(0, ERROR_MAX);
  return reason ? `${COMPACTION_FAILED_LINE}: ${reason}` : COMPACTION_FAILED_LINE;
}

export function createCompactionLines(): (update: CompactionUpdate) => string | null {
  const ended = new Set<string>();
  return (update) => {
    if (!ENDED.has(update.status) || ended.has(update.compactionId)) return null;
    ended.add(update.compactionId);
    if (update.status === 'completed') return COMPACTED_LINE;
    if (update.status === 'failed') return failedLine(update.error);
    return null;
  };
}
