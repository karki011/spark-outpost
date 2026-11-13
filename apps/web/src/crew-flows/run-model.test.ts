import { describe, expect, it } from 'vitest';
import type { WorkflowRun, WorkflowRunStep, WorkflowStepState } from '@spark-outpost/contracts';
import {
  RUN_WORDS,
  STEP_WORDS,
  costText,
  finishedEdges,
  latestRun,
  outcomeText,
  passedTo,
  runElapsed,
  statusParts,
  stepElapsed,
  waitingApproval,
} from './run-model.ts';

const START = '2026-11-13T10:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();
const uuid = (tail: number) => `00000000-0000-4000-8000-${String(tail).padStart(12, '0')}`;

function step(
  stepId: string,
  state: WorkflowStepState,
  dependsOn: string[] = [],
  extra: Partial<WorkflowRunStep> = {},
): WorkflowRunStep {
  return {
    stepId,
    sparkId: uuid(1),
    dependsOn,
    state,
    runId: null,
    note: null,
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}

function run(steps: WorkflowRunStep[], extra: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: uuid(9),
    workflowId: 'pre-pr',
    workflowName: 'Pre-PR review',
    kind: 'run',
    source: 'manual',
    status: 'running',
    conversationId: uuid(2),
    runId: uuid(3),
    stoppedBy: null,
    steps,
    spend: { tokens: 0, costUsd: null, costSource: null },
    startedAt: START,
    finishedAt: null,
    ...extra,
  };
}

const labels = new Map([
  ['security', 'Security'],
  ['lint', 'Lint'],
  ['comment', 'Comment'],
  ['ticket', 'Ticketing'],
]);

describe('state words', () => {
  it('names every step and run state', () => {
    expect(STEP_WORDS).toEqual({
      waiting: 'Waiting',
      running: 'Running',
      succeeded: 'Done',
      failed: 'Failed',
      skipped: 'Skipped',
      cancelled: 'Cancelled',
    });
    expect(RUN_WORDS).toEqual({
      running: 'Running',
      succeeded: 'Done',
      failed: 'Failed',
      cancelled: 'Cancelled',
      outcome_unknown: 'Outcome unknown',
    });
  });
});

describe('finishedEdges', () => {
  it('is solid only where the parent settled and the child started', () => {
    const edges = finishedEdges([
      step('security', 'succeeded'),
      step('lint', 'running'),
      step('comment', 'waiting', ['security', 'lint']),
      step('ticket', 'running', ['security']),
    ]);
    expect([...edges]).toEqual(['security>ticket']);
  });

  it('counts a failed parent the workflow continued past, and never a skipped child', () => {
    const edges = finishedEdges([
      step('security', 'failed'),
      step('lint', 'succeeded'),
      step('comment', 'succeeded', ['security', 'lint']),
      step('ticket', 'skipped', ['comment']),
    ]);
    expect([...edges].sort()).toEqual(['lint>comment', 'security>comment']);
  });

  it('leaves the edge from a cancelled parent unfinished', () => {
    const edges = finishedEdges([
      step('security', 'cancelled'),
      step('comment', 'cancelled', ['security']),
    ]);
    expect(edges.size).toBe(0);
  });
});

describe('passedTo', () => {
  it('lists the steps that depend on a step, in workflow order', () => {
    const steps = [
      step('security', 'succeeded'),
      step('comment', 'waiting', ['security']),
      step('ticket', 'waiting', ['comment', 'security']),
    ];
    expect(passedTo(steps, 'security')).toEqual(['comment', 'ticket']);
    expect(passedTo(steps, 'ticket')).toEqual([]);
  });
});

describe('the status line', () => {
  const steps = [
    step('security', 'succeeded'),
    step('lint', 'succeeded'),
    step('comment', 'running', ['security', 'lint']),
    step('ticket', 'waiting', ['comment']),
  ];

  it('counts finished steps and shows time, tokens and cost while it runs', () => {
    const live = run(steps, { spend: { tokens: 48_200, costUsd: 0.18, costSource: 'reported' } });
    expect(statusParts(live, Date.parse(at(102.7)))).toEqual([
      '2 of 4 steps done',
      '1m 42s',
      '48.2K tokens',
      '$0.18',
    ]);
  });

  it('leaves cost out while running without one and says so once finished', () => {
    expect(statusParts(run(steps), Date.parse(at(5)))).toEqual([
      '2 of 4 steps done',
      '5s',
      '0 tokens',
    ]);
    const ended = run(steps, { status: 'succeeded', finishedAt: at(61) });
    expect(statusParts(ended, Date.parse(at(900)))).toEqual([
      '2 of 4 steps done',
      '1m 1s',
      '0 tokens',
      'cost not reported',
    ]);
  });

  it('marks an estimated or mixed cost', () => {
    const spend = { tokens: 10, costUsd: 0.5, costSource: 'mixed' as const };
    expect(costText(run(steps, { spend }))).toBe('~$0.50');
  });

  it('says one step, not one steps', () => {
    expect(statusParts(run([step('security', 'waiting')]), Date.parse(START))[0]).toBe(
      '0 of 1 step done',
    );
  });

  it('stops the clock at the finish time', () => {
    expect(runElapsed({ startedAt: START, finishedAt: at(12) }, Date.parse(at(500)))).toBe('12s');
  });
});

describe('stepElapsed', () => {
  it('ticks for a running step and freezes for a finished one', () => {
    const running = step('lint', 'running', [], { startedAt: at(10) });
    expect(stepElapsed(running, Date.parse(at(48)))).toBe('38s');
    const done = step('lint', 'succeeded', [], { startedAt: at(10), finishedAt: at(13) });
    expect(stepElapsed(done, Date.parse(at(999)))).toBe('3s');
  });

  it('has no time for a step that never started', () => {
    expect(stepElapsed(step('lint', 'waiting'), Date.parse(at(5)))).toBeNull();
    expect(stepElapsed(step('lint', 'skipped', [], { finishedAt: at(5) }), 0)).toBeNull();
  });
});

describe('outcomeText', () => {
  it('says nothing while running or after a clean finish', () => {
    expect(outcomeText(run([step('security', 'running')]), labels)).toBeNull();
    expect(
      outcomeText(run([step('security', 'succeeded')], { status: 'succeeded' }), labels),
    ).toBeNull();
  });

  it('names the step that stopped the workflow and how many never started', () => {
    const failed = run(
      [
        step('security', 'failed'),
        step('lint', 'succeeded'),
        step('comment', 'skipped', ['security', 'lint']),
        step('ticket', 'skipped', ['comment']),
      ],
      { status: 'failed', stoppedBy: 'security' },
    );
    expect(outcomeText(failed, labels)).toBe(
      'Stopped by Security: it failed, and it is set to stop the workflow. 2 steps did not start.',
    );
  });

  it('names failed steps a finished workflow continued past', () => {
    const done = run([step('security', 'failed'), step('comment', 'succeeded', ['security'])], {
      status: 'succeeded',
    });
    expect(outcomeText(done, labels)).toBe(
      'Security failed, and the workflow continued without it.',
    );
  });

  it('describes a stopped run by what was cancelled and what never started', () => {
    const stopped = run(
      [
        step('security', 'cancelled'),
        step('lint', 'cancelled'),
        step('comment', 'skipped', ['security', 'lint']),
      ],
      { status: 'cancelled' },
    );
    expect(outcomeText(stopped, labels)).toBe(
      'Stopped before it finished. Security and Lint were cancelled. 1 step did not start.',
    );
  });

  it('explains a failed run with no stopping step and an unknown outcome', () => {
    expect(outcomeText(run([step('security', 'failed')], { status: 'failed' }), labels)).toBe(
      'The run failed.',
    );
    expect(
      outcomeText(run([step('security', 'failed')], { status: 'outcome_unknown' }), labels),
    ).toMatch(/^Spark stopped while this ran, so the outcome is unknown\./);
  });
});

describe('waitingApproval', () => {
  const asking = step('lint', 'running', [], { runId: uuid(5) });
  const cards = [
    { id: uuid(70), runId: uuid(5), status: 'allowed' as const },
    { id: uuid(71), runId: uuid(5), status: 'pending' as const },
    { id: uuid(72), runId: uuid(6), status: 'pending' as const },
  ];

  it('finds the pending card of a running step', () => {
    expect(waitingApproval(asking, cards)).toBe(uuid(71));
  });

  it('ignores answered cards, other runs and steps that are not running', () => {
    expect(waitingApproval(asking, cards.slice(0, 1))).toBeNull();
    expect(waitingApproval({ ...asking, state: 'succeeded' }, cards)).toBeNull();
    expect(waitingApproval(step('lint', 'running'), cards)).toBeNull();
  });
});

describe('latestRun', () => {
  it('takes the newest real run and skips test runs', () => {
    const test = run([], { id: uuid(20), kind: 'test' });
    const real = run([], { id: uuid(21) });
    expect(latestRun([test, real])?.id).toBe(uuid(21));
    expect(latestRun([test])).toBeNull();
  });
});
