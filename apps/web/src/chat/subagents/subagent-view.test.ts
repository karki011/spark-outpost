import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import {
  shownSubagents,
  subagentDurationMs,
  subagentLines,
  workingFirst,
} from './subagent-view.ts';

const row = (id: string, parentId: string | null = null): SubagentRow => ({
  ...emptySubagentRecord,
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

  it('lists working sub-agents first, keeping each one with its nested ones and the rest in order', () => {
    const done = (id: string, parentId: string | null = null) => ({
      ...row(id, parentId),
      state: 'done' as const,
    });
    const lines = subagentLines([done('a'), done('b'), row('c', 'b'), row('d'), done('e')]);
    expect(workingFirst(lines).map((line) => line.row.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
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
