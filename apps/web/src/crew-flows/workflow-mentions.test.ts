import { describe, expect, it } from 'vitest';
import type { WorkflowSummary } from '@spark-outpost/contracts';
import { workflowsMatching } from './workflow-mentions.ts';

const flow = (id: string, name: string, problems = 0): WorkflowSummary => ({
  id,
  name,
  stages: [],
  problems,
});
const FLOWS = [flow('review-flow', 'Review flow'), flow('release-check', 'Ship gate')];
const ids = (query: string, flows = FLOWS) =>
  workflowsMatching(flows, query, []).map((entry) => entry.workflow.id);

describe('workflowsMatching', () => {
  it('lists every workflow for a bare @, however many there are', () => {
    expect(ids('')).toEqual(['review-flow', 'release-check']);
    const many = Array.from({ length: 12 }, (_, index) => flow(`flow-${index + 10}`, 'Flow'));
    expect(ids('', many)).toHaveLength(12);
  });

  it('matches the start of the id, of a word in the id or of a word in the name', () => {
    expect(ids('rel')).toEqual(['release-check']);
    expect(ids('Gate')).toEqual(['release-check']);
    expect(ids('flow')).toEqual(['review-flow']);
    expect(ids('check')).toEqual(['release-check']);
    expect(ids('release-ch')).toEqual(['release-check']);
    expect(ids('xyz')).toEqual([]);
  });

  it('lists a workflow with problems, marked so it cannot be run', () => {
    const [entry] = workflowsMatching([flow('broken', 'Broken', 2)], '', []);
    expect(entry?.blocked).toContain('Has problems');
  });

  it('marks a workflow whose id is a Spark name, since @ that name goes to the Spark', () => {
    const flows = [flow('pip', 'Pip checks'), flow('pip-review', 'Pip review')];
    const shown = workflowsMatching(flows, 'pi', [{ name: 'Pip' }]);
    expect(shown.map((entry) => [entry.workflow.id, entry.blocked !== null])).toEqual([
      ['pip', true],
      ['pip-review', false],
    ]);
  });
});
