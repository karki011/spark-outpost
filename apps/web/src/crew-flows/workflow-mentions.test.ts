import { describe, expect, it } from 'vitest';
import type { WorkflowSummary } from '@spark-outpost/contracts';
import { workflowsMatching } from './workflow-mentions.ts';

const flow = (id: string, name: string): WorkflowSummary => ({ id, name, stages: [], problems: 0 });
const FLOWS = [flow('review-flow', 'Review flow'), flow('release-check', 'Ship gate')];

describe('workflowsMatching', () => {
  it('lists every workflow for a bare @', () => {
    expect(workflowsMatching(FLOWS, '').map((entry) => entry.id)).toEqual([
      'review-flow',
      'release-check',
    ]);
  });

  it('matches the start of the id or of a word in the name, ignoring case', () => {
    expect(workflowsMatching(FLOWS, 'rel').map((entry) => entry.id)).toEqual(['release-check']);
    expect(workflowsMatching(FLOWS, 'Gate').map((entry) => entry.id)).toEqual(['release-check']);
    expect(workflowsMatching(FLOWS, 'flow').map((entry) => entry.id)).toEqual(['review-flow']);
    expect(workflowsMatching(FLOWS, 'xyz')).toEqual([]);
  });
});
