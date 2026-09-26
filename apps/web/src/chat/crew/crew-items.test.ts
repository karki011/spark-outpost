import { describe, expect, it } from 'vitest';
import type { CrewMember } from '@spark-outpost/contracts';
import { crewItems, groupParallel } from './crew-items.ts';

const member = (runId: string, parallelGroup: string | null = null) =>
  ({ runId, parallelGroup, startedAt: null }) as CrewMember;

describe('parallel crew items', () => {
  it('folds consecutive members of one parallel group into a group', () => {
    const items = groupParallel(
      crewItems([member('a'), member('b', 'g1'), member('c', 'g1'), member('d')], []),
    );
    expect(items.map((item) => item.kind)).toEqual(['agent', 'group', 'agent']);
    const group = items[1];
    expect(group?.kind === 'group' && group.members.map((entry) => entry.member.runId)).toEqual([
      'b',
      'c',
    ]);
  });

  it('leaves a lone member of a group as a plain block', () => {
    const items = groupParallel(crewItems([member('a', 'g1'), member('b', 'g2')], []));
    expect(items.map((item) => item.kind)).toEqual(['agent', 'agent']);
  });
});
