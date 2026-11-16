import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';

type CompactionUpdate = Extract<SessionUpdate, { sessionUpdate: 'compaction_update' }>;

export const COMPACTING_STEP = 'Compacting the chat';
export const COMPACTED_LINE = 'Context compacted';
export const COMPACTION_FAILED_LINE = 'Warning: Context compaction failed';

const ENDED = new Set(['completed', 'failed', 'cancelled']);
const ERROR_MAX = 300;

export interface CompactionSeen {
  started: boolean;
  finished: boolean;
  line: string | null;
}

const NOTHING: CompactionSeen = { started: false, finished: false, line: null };

function failedLine(error: string | null | undefined): string {
  const reason = error?.trim().slice(0, ERROR_MAX);
  return reason ? `${COMPACTION_FAILED_LINE}: ${reason}` : COMPACTION_FAILED_LINE;
}

function endLine(update: CompactionUpdate): string | null {
  if (update.status === 'completed') return COMPACTED_LINE;
  if (update.status === 'failed') return failedLine(update.error);
  return null;
}

export function createCompactionLines(): (update: CompactionUpdate) => CompactionSeen {
  const open = new Set<string>();
  const ended = new Set<string>();
  return (update) => {
    const id = update.compactionId;
    if (ended.has(id)) return NOTHING;
    if (update.status === 'in_progress') {
      if (open.has(id)) return NOTHING;
      open.add(id);
      return { started: true, finished: false, line: null };
    }
    if (!ENDED.has(update.status)) return NOTHING;
    ended.add(id);
    return { started: false, finished: open.delete(id), line: endLine(update) };
  };
}
