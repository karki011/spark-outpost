import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { turnApprovals } from './crew-items.ts';

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
