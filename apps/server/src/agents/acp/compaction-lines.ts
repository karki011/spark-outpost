import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import type { ProviderOutput } from '../../providers/provider.ts';

type CompactionUpdate = Extract<SessionUpdate, { sessionUpdate: 'compaction_update' }>;

export const COMPACTING_STEP = 'Compacting the chat';
export const COMPACTED_LINE = 'Context compacted';
export const COMPACTION_FAILED_LINE = 'Warning: Context compaction failed';

const ENDED = new Set(['completed', 'failed', 'cancelled']);
const ERROR_MAX = 300;

interface CompactionSeen {
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

export function compactionOutputs(seen: CompactionSeen): ProviderOutput[] {
  return [
    ...(seen.started ? [{ kind: 'step_started', name: COMPACTING_STEP } as const] : []),
    ...(seen.finished ? [{ kind: 'step_finished', name: COMPACTING_STEP } as const] : []),
    ...(seen.line
      ? [
          { kind: 'step_started', name: seen.line } as const,
          { kind: 'step_finished', name: seen.line } as const,
        ]
      : []),
  ];
}
