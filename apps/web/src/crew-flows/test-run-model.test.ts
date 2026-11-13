import { describe, expect, it } from 'vitest';
import type { Approval, WorkflowRunStep, WorkflowTestRun } from '@spark-outpost/contracts';
import {
  cardAnswers,
  cardStep,
  copyLine,
  firstShown,
  heldLine,
  polls,
  progressLine,
  runWord,
  stepTime,
} from './test-run-model.ts';

const START = '2026-11-13T09:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();

function step(stepId: string, extra: Partial<WorkflowRunStep> = {}): WorkflowRunStep {
  return {
    stepId,
    sparkId: '00000000-0000-4000-8000-000000000001',
    state: 'waiting',
    runId: null,
    note: null,
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}

function test(steps: WorkflowRunStep[], extra: Partial<WorkflowTestRun> = {}): WorkflowTestRun {
  return {
    run: {
      id: '00000000-0000-4000-8000-0000000000aa',
      workflowId: 'pre-pr',
      workflowName: 'Pre-PR review',
      kind: 'test',
      source: 'manual',
      status: 'running',
      conversationId: null,
      runId: null,
      stoppedBy: null,
      steps,
      startedAt: START,
      finishedAt: null,
    },
    message: '',
    projectId: null,
    projectName: null,
    oneSpark: false,
    held: [],
    waiting: [],
    usage: { totalTokens: 0, costUsd: null, costSource: null },
    ...extra,
  };
}

describe('the test run line', () => {
  it('counts settled steps, the time so far, tokens and cost', () => {
    const running = test(
      [step('sec', { state: 'succeeded' }), step('lint', { state: 'skipped' }), step('com')],
      { usage: { totalTokens: 12_300, costUsd: 0.21, costSource: 'reported' } },
    );
    expect(progressLine(running, Date.parse(at(125)))).toBe(
      '2 of 3 done · 2m 05s · 12.3K tokens · $0.21',
    );
  });

  it('stops the clock when the run has ended and marks an estimated cost', () => {
    const done = test([step('sec', { state: 'succeeded' })], {
      usage: { totalTokens: 900, costUsd: 0.004, costSource: 'estimated' },
    });
    done.run.status = 'succeeded';
    done.run.finishedAt = at(9);
    expect(progressLine(done, Date.parse(at(600)))).toBe('1 of 1 done · 9s · 900 tokens · ~$0.004');
    expect(runWord(done.run)).toBe('Finished');
    expect(polls(done)).toBe(false);
  });

  it('keeps polling until the first answer and while it runs', () => {
    expect(polls(undefined)).toBe(true);
    expect(polls(test([step('sec')]))).toBe(true);
  });

  it('names the project the copy was made from', () => {
    expect(copyLine({ projectName: 'spark-outpost' })).toContain('copy of spark-outpost');
    expect(copyLine({ projectName: null })).toContain('no project');
  });
});

describe('steps and held sends', () => {
  it('times a step from its start to its end or to now', () => {
    expect(stepTime(step('sec'), 0)).toBeNull();
    expect(stepTime(step('sec', { startedAt: at(0), finishedAt: at(41) }), 0)).toBe('41s');
    expect(stepTime(step('sec', { startedAt: at(0) }), Date.parse(at(3)))).toBe('3s');
  });

  it('shows the chosen step, or else the one working, or else the last with output', () => {
    const steps = [
      step('sec', { state: 'succeeded', note: 'ok' }),
      step('lint', { state: 'running' }),
      step('com'),
    ];
    expect(firstShown(test(steps).run, 'sec')).toBe('sec');
    expect(firstShown(test(steps).run, 'gone')).toBe('lint');
    expect(firstShown(test([steps[0]!, step('com')]).run, null)).toBe('sec');
    expect(firstShown(test([]).run, null)).toBeNull();
  });

  it('labels a held send with its kind and the step that tried it', () => {
    const held = {
      id: '00000000-0000-4000-8000-0000000000bb',
      stepId: 'com',
      kind: 'pull_request' as const,
      summary: 'gh pr create',
      at: START,
    };
    expect(heldLine(held, new Map([['com', 'Comment']]))).toEqual({
      kind: 'Pull request',
      step: 'Comment',
      summary: 'gh pr create',
    });
    expect(heldLine({ ...held, stepId: null }, new Map()).step).toBeNull();
  });
});

describe('a card that waits in a test run', () => {
  const card = {
    runId: '00000000-0000-4000-8000-0000000000cc',
    options: [
      { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
  } as Approval;

  it('offers Allow once and Deny only', () => {
    expect(cardAnswers(card)).toEqual([
      { optionId: 'yes', label: 'Allow once', allows: true },
      { optionId: 'no', label: 'Deny', allows: false },
    ]);
  });

  it('finds the step whose run asked', () => {
    const run = test([step('sec', { runId: card.runId })]).run;
    expect(cardStep(card, run)).toBe('sec');
    expect(cardStep({ ...card, runId: '00000000-0000-4000-8000-0000000000dd' }, run)).toBeNull();
  });
});
