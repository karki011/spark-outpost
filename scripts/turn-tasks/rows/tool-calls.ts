import type { ToolCallFact } from '../tasks/types.ts';
import { fields, type LogRow } from './types.ts';

export function toolUpdate(row: LogRow): Record<string, unknown> | null {
  if (row.direction !== 'from_agent' || row.method !== 'session/update') return null;
  const update = fields(fields(fields(row.payload).params).update);
  const isTool =
    update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update';
  return isTool && typeof update.toolCallId === 'string' ? update : null;
}

function pathsOf(locations: unknown): string[] {
  if (!Array.isArray(locations)) return [];
  return locations.flatMap((location) => {
    const { path } = fields(location);
    return typeof path === 'string' ? [path] : [];
  });
}

export function toolCallFacts(rows: readonly LogRow[]): ToolCallFact[] {
  const calls = new Map<string, ToolCallFact>();
  for (const row of rows) {
    const update = toolUpdate(row);
    if (!update) continue;
    const toolCallId = update.toolCallId as string;
    const key = `${row.runId} ${toolCallId}`;
    const call = calls.get(key) ?? {
      runId: row.runId,
      toolCallId,
      kind: 'other',
      title: '',
      status: null,
      paths: [],
      unreviewed: false,
    };
    if (typeof update.kind === 'string') call.kind = update.kind;
    if (typeof update.title === 'string') call.title = update.title;
    if (typeof update.status === 'string') call.status = update.status;
    const paths = pathsOf(update.locations);
    if (paths.length > 0) call.paths = paths;
    if (row.unreviewed) call.unreviewed = true;
    calls.set(key, call);
  }
  return [...calls.values()];
}
