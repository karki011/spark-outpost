import { describe, expect, it } from 'vitest';
import type { Approval, CrewMember } from '@spark-outpost/contracts';
import { crewItems, groupParallel, turnApprovals } from './crew-items.ts';

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

const approval = (id: string, runId: string, status: Approval['status'] = 'pending') =>
  ({ id, runId, status, createdAt: `2026-09-27T00:00:0${id.length}Z` }) as Approval;

describe('turnApprovals', () => {
  it("keeps only the approvals of this turn's runs, so a later turn's cards render once", () => {
    const stored = [approval('p1', 'turn-1'), approval('p2', 'turn-2'), approval('e1', 'bolt-1')];
    expect(turnApprovals(['turn-1', 'bolt-1'], stored, []).map((item) => item.id)).toEqual([
      'p1',
      'e1',
    ]);
  });

  it('prefers a decided streamed copy over the stored pending one', () => {
    const merged = turnApprovals(
      ['turn-1'],
      [approval('p1', 'turn-1')],
      [approval('p1', 'turn-1', 'allowed')],
    );
    expect(merged.map((item) => item.status)).toEqual(['allowed']);
  });
});
