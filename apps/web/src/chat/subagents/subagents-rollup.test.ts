import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { rollupRows } from './subagents-rollup.ts';

function row(id: string, name: string, state: SubagentRow['state']): SubagentRow {
  return {
    ...emptySubagentRecord,
    id,
    name,
    task: '',
    parentId: null,
    state,
    step: null,
    startedAt: null,
    endedAt: null,
  };
}

const builders = (count: number, state: SubagentRow['state']) =>
  Array.from({ length: count }, (_, index) => row(`b${index}`, 'Builder', state));

describe('rollupRows', () => {
  it('leaves four or fewer workers alone', () => {
    expect(rollupRows(builders(4, 'done'), true)).toBeNull();
    expect(rollupRows([], true)).toBeNull();
  });

  it('groups one role by state and keeps working workers visible', () => {
    const rows = [...builders(12, 'done'), row('w', 'Builder', 'working')];
    const result = rollupRows(rows, true);
    expect(result?.text).toBe('13 Builders · 12 done · 1 working');
  });

  it('groups several roles and counts a single worker in the singular', () => {
    const rows = [
      ...builders(9, 'done'),
      ...Array.from({ length: 4 }, (_, index) => row(`r${index}`, 'Reviewer', 'done')),
      row('w1', 'Reviewer', 'working'),
      row('w2', 'Verifier', 'working'),
    ];
    expect(rollupRows(rows, true)?.text).toBe(
      '9 Builders, 5 Reviewers, 1 Verifier · 13 done · 2 working',
    );
  });

  it('never hides failed or stopped workers inside the count', () => {
    const rows = [
      ...builders(4, 'done'),
      row('f', 'Builder', 'failed'),
      row('c', 'Builder', 'cancelled'),
    ];
    const result = rollupRows(rows, true);
    expect(result?.text).toBe('6 Builders · 4 done · 1 failed · 1 stopped');
  });

  it('calls unnamed workers agents and shows stale workers as inactive once the turn ended', () => {
    const rows = [...builders(4, 'done'), row('x', 'Look around', 'working')];
    const result = rollupRows(rows, false);
    expect(result?.text).toBe('4 Builders, 1 Agent · 4 done · 1 inactive');
  });

  it('summarises a roll-up of finished workers', () => {
    expect(rollupRows(builders(5, 'done'), true)?.text).toBe('5 Builders · 5 done');
  });
});
