import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type CrewMember } from '@spark-outpost/contracts';
import { coveredMs } from './budget.ts';
import {
  batchGroups,
  conflictLine,
  groupMembers,
  isResearchStep,
  largeFromReply,
  firstOpenStep,
  parallelFromReply,
  parallelGroups,
  parallelTag,
  planGroups,
  worthSplitting,
} from './parallel.ts';
import { builderSpans, carriedSteps } from './spans.ts';
import { initialFlow, nextStep, type FlowEvent, type FlowResult } from './transitions.ts';
import { orderCrew } from './view.ts';

const PLAN = [
  'Add the date helper in src/dates.ts',
  'Update src/divider.tsx to use it [parallel A]',
  'Update src/turns.ts to use it [parallel A]',
  'Write the changelog in CHANGELOG.md',
];

describe('parallel groups from the plan', () => {
  it('groups consecutive steps that share a tag', () => {
    expect(parallelTag(PLAN[1]!)).toBe('a');
    expect(parallelTag(PLAN[0]!)).toBeNull();
    expect(parallelGroups(PLAN)).toEqual([[1, 2]]);
  });

  it('keeps tagged steps apart when something else sits between them', () => {
    const steps = ['One in a.ts [parallel A]', 'Two in b.ts', 'Three in c.ts [parallel A]'];
    expect(parallelGroups(steps)).toEqual([]);
  });

  it('splits a tagged run where the steps name the same file', () => {
    const steps = [
      'Edit src/format.ts [parallel B]',
      'Test src/format.ts [parallel B]',
      'Edit src/parse.ts [parallel B]',
    ];
    expect(parallelGroups(steps)).toEqual([[1, 2]]);
  });

  it('needs every line of a batched step to carry the same tag', () => {
    expect(parallelTag('Edit a.ts [parallel A]\nEdit b.ts [parallel A]')).toBe('a');
    expect(parallelTag('Edit a.ts [parallel A]\nEdit b.ts')).toBeNull();
  });

  it('reads a Parallel line from the Architect’s reply', () => {
    const reply = 'Plan ready.\n\nParallel: 2, 3; 5 and 6';
    expect(parallelFromReply(reply, 6)).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(parallelFromReply('**Parallel:** 2, 3', 4)).toEqual([[1, 2]]);
    expect(parallelFromReply('- Parallel: steps 3 and 4', 4)).toEqual([[2, 3]]);
    expect(parallelFromReply('Parallel: 1, 3', 4)).toEqual([]);
    expect(parallelFromReply('No hints.', 4)).toEqual([]);
    expect(planGroups(['a.ts', 'b.ts', 'c.ts'], [[1, 2]])).toEqual([[1, 2]]);
    expect(planGroups(['x', 'Edit b.ts', 'Test b.ts'], [[1, 2]])).toEqual([]);
  });

  it('keeps a group when batching joins steps of the same group', () => {
    const ranges = [
      [0, 1],
      [2, 3],
      [4, 5],
    ];
    expect(batchGroups([[2, 3, 4, 5]], ranges)).toEqual([[1, 2]]);
    expect(batchGroups([[1, 2, 3]], ranges)).toEqual([]);
  });

  it('reads the Large line and keeps only groups worth their own Builders', () => {
    expect(largeFromReply('Plan ready.\nParallel: 2, 3\n**Large:** 2, 3', 4)).toEqual([1, 2]);
    expect(largeFromReply('Large: 9', 4)).toEqual([]);
    expect(worthSplitting([[1, 2]], PLAN, [])).toEqual([]);
    expect(worthSplitting([[1, 2]], PLAN, [1, 2])).toEqual([[1, 2]]);
    const twoFiles = ['x', 'Edit a.ts and test/a.test.ts', 'Edit b.ts and test/b.test.ts'];
    expect(worthSplitting([[1, 2]], twoFiles, [])).toEqual([[1, 2]]);
    expect(worthSplitting([[0, 1]], ['Research: a', 'Research: b'], [])).toEqual([[0, 1]]);
  });

  it('carries consecutive steps outside parallel groups in one Builder', () => {
    const steps = ['a', 'b', 'c', 'd', 'e'];
    expect(builderSpans(steps, [])).toEqual([[0, 1, 2, 3, 4]]);
    expect(builderSpans(steps, [[1, 2]])).toEqual([[0], [1], [2], [3, 4]]);
    expect(carriedSteps(steps, [], [1], 0)).toEqual([0]);
    expect(builderSpans(['a', 'Research: b', 'c'], [])).toEqual([[0], [1], [2]]);
  });

  it('recognises research steps', () => {
    expect(isResearchStep('Research: how dates are parsed [parallel R]')).toBe(true);
    expect(isResearchStep('Update the parser')).toBe(false);
  });
});

describe('group members', () => {
  const steps = ['Research: a', 'Research: b', 'Edit a.ts', 'Edit b.ts'];
  const groups = [[0, 1, 2, 3]];

  it('runs every open member when Builders get their own copies', () => {
    expect(groupMembers(groups, [], steps, 0, true)).toEqual([0, 1, 2, 3]);
    expect(groupMembers(groups, [1], steps, 0, true)).toEqual([0, 2, 3]);
  });

  it('keeps one Builder per group without copies, alongside the Scouts', () => {
    expect(groupMembers(groups, [], steps, 0, false)).toEqual([0, 1, 2]);
    expect(groupMembers(groups, [0, 1, 2], steps, 3, false)).toEqual([3]);
  });

  it('finds the next step that has not run yet', () => {
    expect(firstOpenStep(['a', 'b', 'c', 'd'], [0, 1, 2])).toBe(3);
    expect(firstOpenStep(['a', 'b', 'c'], [0, 2])).toBe(1);
    expect(firstOpenStep(['a', 'b'], [0, 1])).toBeNull();
  });
});

function run(events: FlowEvent[], worktrees = true): FlowResult[] {
  let state = initialFlow('plan_execute', 'multi-file', 'hands-off', worktrees);
  return events.map((event) => {
    const result = nextStep(state, event);
    state = result.state;
    return result;
  });
}

const start: FlowEvent = { type: 'start', intake: 'act' };
const planned: FlowEvent = {
  type: 'agent_done',
  role: 'architect',
  outcome: 'succeeded',
  steps: PLAN.slice(0, 3),
  large: [1, 2],
};
const builderDone: FlowEvent = { type: 'agent_done', role: 'builder', outcome: 'succeeded' };
const next: FlowEvent = {
  type: 'judged',
  status: 'done',
  next: 'next_step',
  rules: { status: 'done', next: 'next_step' },
  source: 'rules',
  confidence: null,
};
const group = (outcomes: ('succeeded' | 'failed' | 'cancelled')[], stopped = false): FlowEvent => ({
  type: 'group_done',
  results: outcomes.map((outcome, index) => ({ stepIndex: index + 1, outcome })),
  stopped,
});

describe('parallel flow', () => {
  it('spawns the tagged steps together after the first step', () => {
    const results = run([start, planned, builderDone, next]);
    expect(results.at(-1)?.action).toEqual({ type: 'spawn_group', stepIndexes: [1, 2] });
    expect(results.at(-1)?.state.phase).toBe('building');
  });

  it('wraps up once every member merged', () => {
    const results = run([start, planned, builderDone, next, group(['succeeded', 'succeeded'])]);
    expect(results.at(-1)?.action).toEqual({ type: 'wrap_up' });
    expect(results.at(-1)?.state.completed).toEqual([0, 1, 2]);
  });

  it('retries a failed member one tier up in the main copy', () => {
    const results = run([start, planned, builderDone, next, group(['succeeded', 'failed'])]);
    expect(results.at(-1)?.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      stepIndex: 2,
      reason: 'retry',
      escalate: true,
    });
    const after = nextStep(results.at(-1)!.state, builderDone);
    const judgedDone = nextStep(after.state, { ...next, next: 'next_step' });
    expect(judgedDone.action).toEqual({ type: 'wrap_up' });
  });

  it('stops when you stop at a merge conflict', () => {
    const results = run([start, planned, builderDone, next, group(['succeeded', 'failed'], true)]);
    expect(results.at(-1)?.action).toEqual({
      type: 'finish',
      status: 'cancelled',
      reason: 'You stopped it.',
    });
  });

  it('restarts the open members when you continue past the budget', () => {
    const results = run([
      start,
      planned,
      builderDone,
      next,
      { type: 'budget_exceeded', limit: 'time' },
      {
        type: 'answered',
        kind: 'budget',
        optionId: CHECKPOINT_OPTION.continueBudget,
        note: null,
      },
    ]);
    expect(results.at(-1)?.action).toEqual({ type: 'spawn_group', stepIndexes: [1, 2] });
  });

  it('gives every step to one Builder without git copies', () => {
    const results = run([start, planned, builderDone, next], false);
    expect(results.map((result) => result.action.type)).toEqual([
      'spawn',
      'spawn',
      'judge',
      'wrap_up',
    ]);
    expect(results[1]?.action).toMatchObject({ role: 'builder', stepIndex: 0, carry: [0, 1, 2] });
  });

  it('keeps small parallel steps in one Builder', () => {
    const small: FlowEvent = { ...planned, large: [] };
    const results = run([start, small]);
    expect(results.at(-1)?.action).toMatchObject({ role: 'builder', carry: [0, 1, 2] });
  });

  it('carries the steps after a parallel group in one Builder', () => {
    const steps = [PLAN[1]!, PLAN[2]!, 'Write the changelog', 'Update the README'];
    const four: FlowEvent = { ...planned, steps, large: [0, 1] };
    const merged: FlowEvent = {
      type: 'group_done',
      results: [0, 1].map((stepIndex) => ({ stepIndex, outcome: 'succeeded' as const })),
      stopped: false,
    };
    const results = run([start, four, merged]);
    expect(results[1]?.action).toEqual({ type: 'spawn_group', stepIndexes: [0, 1] });
    expect(results.at(-1)?.action).toMatchObject({ role: 'builder', stepIndex: 2, carry: [2, 3] });
  });
});

describe('merge conflicts and ordering', () => {
  it('names both Builders and the file', () => {
    expect(conflictLine('Bolt', 'Rivet', ['format.ts'])).toBe(
      'Bolt and Rivet both changed format.ts.',
    );
    expect(conflictLine('Bolt', 'Rivet', ['a.ts', 'b.ts', 'c.ts'])).toBe(
      'Bolt and Rivet both changed a.ts and 2 more.',
    );
  });

  it('lists a parallel group together in plan order', () => {
    const member = (name: string, stepIndex: number, parallelGroup: string | null) =>
      ({ name, stepIndex, attempt: 1, parallelGroup }) as CrewMember;
    const crew = [
      member('Sketch', 0, null),
      member('Tack', 2, 'g1'),
      member('Hawk', 0, null),
      member('Rivet', 1, 'g1'),
    ];
    expect(orderCrew(crew).map((entry) => entry.name)).toEqual(['Sketch', 'Rivet', 'Tack', 'Hawk']);
  });

  it('counts overlapping approval waits once', () => {
    expect(
      coveredMs([
        [0, 100],
        [50, 150],
        [300, 400],
      ]),
    ).toBe(250);
  });
});
