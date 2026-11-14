import { describe, expect, it } from 'vitest';
import { workflowProblems, workflowSchema, workflowStages } from './crew-workflow.ts';

const SPARK = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const GONE = '1f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const known = new Set([SPARK]);

function step(id: string, dependsOn: string[] = [], sparkId = SPARK) {
  return { id, dependsOn, sparkId };
}

const review = [
  step('security'),
  step('lint'),
  step('types'),
  step('scope'),
  step('comment', ['security', 'lint', 'types', 'scope']),
  step('ticketing', ['comment']),
];

describe('workflowSchema', () => {
  it('fills step defaults', () => {
    const parsed = workflowSchema.parse({
      id: 'pre-pr-review',
      name: 'Pre-PR review',
      steps: [{ id: 'security', sparkId: SPARK }],
    });
    expect(parsed.steps[0]).toEqual({
      id: 'security',
      sparkId: SPARK,
      prompt: '',
      dependsOn: [],
      join: 'all',
      onFailure: 'stop',
    });
  });

  it('refuses a workflow with no steps', () => {
    expect(workflowSchema.safeParse({ id: 'empty', name: 'Empty', steps: [] }).success).toBe(false);
  });
});

describe('workflowProblems', () => {
  it('finds nothing wrong with a fan-in workflow', () => {
    expect(workflowProblems(review, known)).toEqual([]);
  });

  it('reports duplicates, unknown parents, self and missing Sparks', () => {
    const kinds = workflowProblems(
      [step('a'), step('a'), step('b', ['b']), step('c', ['nope']), step('d', [], GONE)],
      known,
    ).map((problem) => `${problem.kind}:${problem.stepId}`);
    expect(kinds).toEqual(['duplicate_step:a', 'self:b', 'unknown_step:c', 'unknown_spark:d']);
  });

  it('reports each cycle once with its path', () => {
    const problems = workflowProblems(
      [step('a', ['c']), step('b', ['a']), step('c', ['b']), step('d', ['a'])],
      known,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('cycle');
    expect(problems[0]?.text).toContain('a → c → b → a');
  });
});

describe('workflowStages', () => {
  it('puts a step one stage after its latest parent', () => {
    expect(workflowStages(review)).toEqual([
      ['security', 'lint', 'types', 'scope'],
      ['comment'],
      ['ticketing'],
    ]);
    expect(workflowStages([step('a'), step('b', ['a']), step('c', ['a', 'b'])])).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('ignores unknown parents and keeps steps in a cycle in a last stage', () => {
    expect(workflowStages([step('a', ['nope']), step('x', ['y']), step('y', ['x'])])).toEqual([
      ['a'],
      ['x', 'y'],
    ]);
  });
});
