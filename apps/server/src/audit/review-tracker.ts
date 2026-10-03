import { objectFields } from '../agents/acp/object-fields.ts';
import { isSparkPlanFile } from '../plans/plan-mode.ts';

const NO_REVIEW_NEEDED = new Set(['read', 'search', 'think', 'switch_mode']);
const RAN = new Set(['completed', 'failed']);

export interface RanTool {
  toolCallId: string;
  kind: string;
}

export interface ReviewTracker {
  asked(toolCallId: string): void;
  settle(update: unknown): RanTool | null;
}

export function createReviewTracker(): ReviewTracker {
  const asked = new Set<string>();
  const kinds = new Map<string, string>();
  const settled = new Set<string>();
  const planFiles = new Set<string>();
  return {
    asked(toolCallId) {
      asked.add(toolCallId);
    },
    settle(raw) {
      const update = objectFields(raw);
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
        return null;
      }
      const id = update.toolCallId;
      if (typeof id !== 'string' || settled.has(id)) return null;
      if (typeof update.kind === 'string') kinds.set(id, update.kind);
      if (isSparkPlanFile(objectFields(update.rawInput).file_path)) planFiles.add(id);
      if (typeof update.status !== 'string' || !RAN.has(update.status)) return null;
      settled.add(id);
      const kind = kinds.get(id) ?? 'other';
      if (asked.has(id) || planFiles.has(id) || NO_REVIEW_NEEDED.has(kind)) return null;
      return { toolCallId: id, kind };
    },
  };
}

export function permissionToolCallId(message: unknown): string | null {
  const fields = objectFields(message);
  if (fields.method !== 'session/request_permission') return null;
  const id = objectFields(objectFields(fields.params).toolCall).toolCallId;
  return typeof id === 'string' ? id : null;
}

export function sessionUpdateOf(message: unknown): unknown {
  const fields = objectFields(message);
  if (fields.method !== 'session/update') return null;
  return objectFields(fields.params).update ?? null;
}
