import { describe, expect, it } from 'vitest';
import { planWorkflow, workflowOutcome } from './crew-run.ts';
import { workflowSchema, type Workflow } from './crew-workflow.ts';
import {
  WORKFLOW_RUN_STEPS_MAX,
  expandWorkflow,
  expandedWorkflowSchema,
  nestedWorkflowProblems,
} from './crew-workflow-nesting.ts';

const SPARK = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const OTHER = '2f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const known = new Set([SPARK, OTHER]);

function flow(id: string, steps: Record<string, unknown>[]): Workflow {
  return workflowSchema.parse({ id, name: id.toUpperCase(), steps });
}

function finder(...workflows: Workflow[]) {
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  return (id: string) => byId.get(id) ?? null;
}

const review = flow('review', [
  { id: 'security', sparkId: SPARK, prompt: 'Look for injection.' },
  { id: 'lint', sparkId: SPARK },
  { id: 'sum', sparkId: OTHER, dependsOn: ['security', 'lint'], join: 'any' },
]);

const ship = flow('ship', [
  { id: 'build', sparkId: SPARK },
  { id: 'check', workflowId: 'review', dependsOn: ['build'], prompt: 'Only the diff.' },
  { id: 'notes', sparkId: OTHER, dependsOn: ['check'] },
]);

describe('a step names a Spark or a workflow', () => {
  it('refuses a step with both or neither', () => {
    const both = {
      id: 'x',
      name: 'X',
      steps: [{ id: 'aa', sparkId: SPARK, workflowId: 'review' }],
    };
    const neither = { id: 'x', name: 'X', steps: [{ id: 'aa' }] };
    expect(workflowSchema.safeParse(both).success).toBe(false);
    expect(workflowSchema.safeParse(neither).success).toBe(false);
  });
});

describe('expandWorkflow', () => {
  it('leaves a workflow of Spark steps as it is', () => {
    expect(expandWorkflow(review, finder()).steps.map((step) => step.id)).toEqual([
      'security',
      'lint',
      'sum',
    ]);
  });

  it('puts the inner steps in place of the step, wired to its parents and children', () => {
    const { steps } = expandWorkflow(ship, finder(review));
    expect(steps.map((step) => [step.id, step.dependsOn, step.join])).toEqual([
      ['build', [], 'all'],
      ['check.security', ['build'], 'all'],
      ['check.lint', ['build'], 'all'],
      ['check.sum', ['check.security', 'check.lint'], 'any'],
      ['notes', ['check.sum'], 'all'],
    ]);
    expect(expandedWorkflowSchema.safeParse({ id: 'ship', name: 'Ship', steps }).success).toBe(
      true,
    );
  });

  it('adds the step’s prompt before each inner prompt', () => {
    const { steps } = expandWorkflow(ship, finder(review));
    expect(steps.find((step) => step.id === 'check.security')?.prompt).toBe(
      'Only the diff.\n\nLook for injection.',
    );
    expect(steps.find((step) => step.id === 'check.lint')?.prompt).toBe('Only the diff.');
  });

  it('waits on every last step of an inner workflow with several', () => {
    const pair = flow('pair', [
      { id: 'left', sparkId: SPARK },
      { id: 'right', sparkId: SPARK },
    ]);
    const outer = flow('outer', [
      { id: 'both', workflowId: 'pair' },
      { id: 'after', sparkId: OTHER, dependsOn: ['both'] },
    ]);
    const { steps } = expandWorkflow(outer, finder(pair));
    expect(steps.find((step) => step.id === 'after')?.dependsOn).toEqual([
      'both.left',
      'both.right',
    ]);
  });

  it('expands a workflow inside a workflow inside a workflow', () => {
    const release = flow('release', [
      { id: 'gate', workflowId: 'ship' },
      { id: 'announce', sparkId: OTHER, dependsOn: ['gate'] },
    ]);
    const { steps } = expandWorkflow(release, finder(ship, review));
    expect(steps.map((step) => step.id)).toEqual([
      'gate.build',
      'gate.check.security',
      'gate.check.lint',
      'gate.check.sum',
      'gate.notes',
      'announce',
    ]);
    expect(steps.find((step) => step.id === 'announce')?.dependsOn).toEqual(['gate.notes']);
    expect(steps.find((step) => step.id === 'gate.check.security')?.dependsOn).toEqual([
      'gate.build',
    ]);
  });

  it('stops the whole run when an inner step set to stop fails', () => {
    const { steps } = expandWorkflow(ship, finder(review));
    const states = { build: 'succeeded', 'check.security': 'failed' } as const;
    expect(planWorkflow(steps, states).stoppedBy).toBe('check.security');
    expect(workflowOutcome(steps, states)).toBe('failed');
  });

  it('keeps going past inner failures when the step is set to continue', () => {
    const lenient = flow('lenient', [
      { id: 'check', workflowId: 'review', onFailure: 'continue' },
      { id: 'notes', sparkId: OTHER, dependsOn: ['check'] },
    ]);
    const { steps } = expandWorkflow(lenient, finder(review));
    expect(steps.every((step) => step.id === 'notes' || step.onFailure === 'continue')).toBe(true);
    const states = {
      'check.security': 'failed',
      'check.lint': 'failed',
      'check.sum': 'failed',
    } as const;
    expect(planWorkflow(steps, states).start).toEqual(['notes']);
  });
});

describe('nestedWorkflowProblems', () => {
  it('finds none in a sound nesting', () => {
    expect(nestedWorkflowProblems(ship, known, finder(review))).toEqual([]);
  });

  it('names a workflow that no longer exists', () => {
    expect(nestedWorkflowProblems(ship, known, finder())).toEqual([
      {
        kind: 'unknown_workflow',
        stepId: 'check',
        text: 'check uses a workflow that no longer exists.',
      },
    ]);
  });

  it('refuses a workflow that runs itself, directly or through another', () => {
    const selfish = flow('selfish', [{ id: 'again', workflowId: 'selfish' }]);
    expect(nestedWorkflowProblems(selfish, known, finder(selfish))[0]?.kind).toBe('workflow_cycle');

    const ping = flow('ping', [{ id: 'to-pong', workflowId: 'pong' }]);
    const pong = flow('pong', [{ id: 'to-ping', workflowId: 'ping' }]);
    expect(nestedWorkflowProblems(ping, known, finder(ping, pong))).toEqual([
      {
        kind: 'workflow_cycle',
        stepId: 'to-pong',
        text: 'to-pong uses PONG, which uses this workflow.',
      },
    ]);
  });

  it('ends on a cycle further in that does not include the workflow', () => {
    const ping = flow('ping', [{ id: 'to-pong', workflowId: 'pong' }]);
    const pong = flow('pong', [{ id: 'to-ping', workflowId: 'ping' }]);
    const outer = flow('outer', [{ id: 'play', workflowId: 'ping' }]);
    expect(nestedWorkflowProblems(outer, known, finder(ping, pong))[0]).toMatchObject({
      kind: 'inner_problem',
      stepId: 'play',
    });
  });

  it('passes on a problem inside a used workflow', () => {
    const [problem] = nestedWorkflowProblems(ship, new Set([SPARK]), finder(review));
    expect(problem).toEqual({
      kind: 'unknown_spark',
      stepId: 'notes',
      text: 'notes uses a Spark that no longer exists.',
    });
    const inner = nestedWorkflowProblems(ship, new Set([SPARK]), finder(review))[1];
    expect(inner).toEqual({
      kind: 'inner_problem',
      stepId: 'check',
      text: 'check uses REVIEW, which has a problem: sum uses a Spark that no longer exists.',
    });
  });

  it('refuses a nesting that runs too many steps', () => {
    const wide = flow(
      'wide',
      Array.from({ length: 100 }, (_, index) => ({ id: `s${index + 10}`, sparkId: SPARK })),
    );
    const times = Math.floor(WORKFLOW_RUN_STEPS_MAX / 100) + 1;
    const outer = flow(
      'outer',
      Array.from({ length: times }, (_, index) => ({ id: `w${index + 10}`, workflowId: 'wide' })),
    );
    expect(nestedWorkflowProblems(outer, known, finder(wide))).toEqual([
      expect.objectContaining({ kind: 'too_many_steps', stepId: 'w10' }),
    ]);
  });
});
