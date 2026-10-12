import type { SubagentRow } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { shownSubagents, subagentDurationMs, subagentLines } from './subagent-view.ts';

const row = (id: string, parentId: string | null = null): SubagentRow => ({
  id,
  name: id,
  task: '',
  parentId,
  state: 'working',
  step: null,
  startedAt: 1_000,
  endedAt: null,
});

describe('sub-agent rows', () => {
  it('puts a nested sub-agent under the one that started it', () => {
    const lines = subagentLines([row('a'), row('b'), row('c', 'a'), row('d', 'c')]);
    expect(lines.map((line) => [line.row.id, line.depth])).toEqual([
      ['a', 0],
      ['c', 1],
      ['d', 2],
      ['b', 0],
    ]);
  });

  it('keeps a sub-agent whose parent is unknown at the top', () => {
    expect(subagentLines([row('a', 'gone')]).map((line) => line.depth)).toEqual([0]);
  });

  it('times a sub-agent only once it has ended', () => {
    expect(subagentDurationMs(row('a'))).toBeNull();
    expect(subagentDurationMs({ ...row('a'), endedAt: 4_500 })).toBe(3_500);
  });

  it('shows the stored rows once the stream no longer leads', () => {
    const streamed = [row('a')];
    const stored = [{ ...row('a'), state: 'done' as const }];
    expect(shownSubagents(streamed, stored, true)).toBe(streamed);
    expect(shownSubagents(streamed, stored, false)).toBe(stored);
    expect(shownSubagents(streamed, undefined, false)).toBe(streamed);
  });
});
