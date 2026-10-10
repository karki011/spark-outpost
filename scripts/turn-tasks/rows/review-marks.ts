import { toolUpdate } from './tool-calls.ts';
import type { LogRow } from './types.ts';

const SPARK_TOOL_TITLE = /^mcp__spark(_outpost)?__/;

export interface MarkedCall {
  toolCallId: string;
  kind: string;
  title: string;
}

export interface ReviewMarks {
  sparkTools: number;
  other: MarkedCall[];
}

export function isSparkToolCall(call: Pick<MarkedCall, 'kind' | 'title'>): boolean {
  return call.kind === 'other' && SPARK_TOOL_TITLE.test(call.title);
}

export function reviewMarks(rows: readonly LogRow[]): ReviewMarks {
  const calls = new Map<string, MarkedCall>();
  const marked: MarkedCall[] = [];
  for (const row of rows) {
    const update = toolUpdate(row);
    if (!update) continue;
    const toolCallId = update.toolCallId as string;
    const key = `${row.runId} ${toolCallId}`;
    const call = calls.get(key) ?? { toolCallId, kind: 'other', title: '' };
    if (typeof update.kind === 'string') call.kind = update.kind;
    if (typeof update.title === 'string') call.title = update.title;
    calls.set(key, call);
    if (row.unreviewed) marked.push({ ...call });
  }
  return {
    sparkTools: marked.filter(isSparkToolCall).length,
    other: marked.filter((call) => !isSparkToolCall(call)),
  };
}
