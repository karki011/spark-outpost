import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { BUILDER_COUNT_AT } from '../advisor/policy.ts';
import {
  BUILDER_COUNTS,
  BUILDERS_KEY,
  clampCount,
  countVerdict,
  planTasks,
  readCount,
} from './builder-count.ts';
import { builderQuestions } from './builder-jev.ts';

function counted(choice: string, confidence: number): SystemOneResponse {
  const rest = Object.keys(BUILDER_COUNTS).filter((option) => option !== choice);
  return {
    model: 'jev-test',
    answers: {
      [BUILDERS_KEY]: {
        type: 'choice',
        choice,
        confidence,
        probabilities: {
          [choice]: 0.85,
          ...Object.fromEntries(rest.map((option) => [option, 0.05])),
        },
      },
    },
  };
}

describe('planTasks', () => {
  it('turns plan items into tasks and makes a later item wait for one that names its files', () => {
    const tasks = planTasks([
      { text: 'Add the store', files: ['store.ts'] },
      { text: 'Add the API', files: ['api.ts'] },
      { text: 'Use the store in the view', files: ['view.ts', 'store.ts'] },
    ]);
    expect(tasks.map((task) => [task.key, task.owns, task.dependsOn])).toEqual([
      ['T1', ['store.ts'], []],
      ['T2', ['api.ts'], []],
      ['T3', ['view.ts', 'store.ts'], ['T1']],
    ]);
  });
});

describe('builderQuestions', () => {
  it('asks the Builder count once, beside the per-task property questions, in one batch', () => {
    const tasks = planTasks([
      { text: 'Add the store', files: ['store.ts'] },
      { text: 'Add the API', files: ['api.ts'] },
    ]);
    const built = builderQuestions({
      request: 'Build it',
      pieces: tasks,
      facts: new Map(),
    });
    const keys = Object.keys(built.questions);
    expect(keys[0]).toBe(BUILDERS_KEY);
    expect(keys.filter((key) => key === BUILDERS_KEY)).toHaveLength(1);
    expect(keys).toEqual(
      expect.arrayContaining(['T1_kind', 'T1_reasoning', 'T2_context', 'T2_reliability']),
    );
    expect(Object.keys(built.questions[BUILDERS_KEY]!.criteria as object)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(String(built.state.pieces)).toContain('Piece T1: Add the store');
  });
});

describe('clampCount', () => {
  it('keeps the count between 1 and 4, the number of tasks and the Builders-at-once setting', () => {
    expect(clampCount(4, { tasks: 6, slots: 3 })).toBe(3);
    expect(clampCount(4, { tasks: 2, slots: 3 })).toBe(2);
    expect(clampCount(3, { tasks: 8, slots: 8 })).toBe(3);
    expect(clampCount(9, { tasks: 8, slots: 8 })).toBe(4);
    expect(clampCount(2, { tasks: 5, slots: 1 })).toBe(1);
    expect(clampCount(0, { tasks: 5, slots: 3 })).toBe(1);
  });
});

describe('countVerdict', () => {
  it('uses a confident count, clamped', () => {
    const verdict = countVerdict(readCount(counted('4', 0.84)), { tasks: 3, slots: 3 });
    expect(verdict).toEqual({ confident: true, asked: 4, confidence: 0.84, count: 3 });
  });

  it('falls back to the rules below the threshold or without a usable answer', () => {
    const unsure = countVerdict(readCount(counted('2', BUILDER_COUNT_AT - 0.01)), {
      tasks: 3,
      slots: 3,
    });
    expect(unsure).toEqual({
      confident: false,
      reason: `Jev was unsure of the Builder count (${(BUILDER_COUNT_AT - 0.01).toFixed(2)})`,
    });
    const missing = countVerdict(readCount({ model: 'jev-test', answers: {} }), {
      tasks: 3,
      slots: 3,
    });
    expect(missing).toEqual({
      confident: false,
      reason: 'Jev gave no Builder count (missing-answer)',
    });
  });
});
