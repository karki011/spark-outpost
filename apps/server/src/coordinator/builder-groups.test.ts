import { describe, expect, it } from 'vitest';
import { foldAnswer, groupAnswer, groupTasks, type GroupTask } from './builder-groups.ts';
import type { PieceAnswer } from './piece-questions.ts';

function task(key: string, files: string[], extra: Partial<GroupTask> = {}): GroupTask {
  return { key, files, areas: [], destructive: false, repo: '/repo', ...extra };
}

function answer(extra: Partial<PieceAnswer> = {}): PieceAnswer {
  return {
    kind: { choice: 'implement', confidence: 0.9, probabilities: { implement: 0.9 } },
    reasoning: { mean: 2, confidence: 0.9 },
    coding: { mean: 2, confidence: 0.9 },
    context: { mean: 2, confidence: 0.9 },
    reliability: 0.1,
    ...extra,
  };
}

describe('groupTasks', () => {
  it('gives each task its own Builder when the count matches', () => {
    const tasks = [task('T1', ['a.ts']), task('T2', ['b.ts']), task('T3', ['c.ts'])];
    expect(groupTasks(tasks, 3)).toEqual([['T1'], ['T2'], ['T3']]);
  });

  it('keeps tasks that share files together, even past the count', () => {
    const tasks = [task('T1', ['a.ts']), task('T2', ['b.ts']), task('T3', ['a.ts', 'c.ts'])];
    expect(groupTasks(tasks, 3)).toEqual([['T1', 'T3'], ['T2']]);
  });

  it('joins tasks in the same Map area before neighbours in the plan', () => {
    const tasks = [
      task('T1', ['src/a.ts'], { areas: ['Store'] }),
      task('T2', ['web/b.tsx'], { areas: ['View'] }),
      task('T3', ['src/c.ts'], { areas: ['Store'] }),
    ];
    expect(groupTasks(tasks, 2)).toEqual([['T1', 'T3'], ['T2']]);
  });

  it('joins plan neighbours when nothing else ties the tasks', () => {
    const tasks = [task('T1', ['a.ts']), task('T2', ['b.ts']), task('T3', ['c.ts'])];
    expect(groupTasks(tasks, 2)).toEqual([['T1', 'T2'], ['T3']]);
  });

  it('never groups destructive with non-destructive work, even when they share files', () => {
    const tasks = [
      task('T1', ['db/0001.sql'], { destructive: true }),
      task('T2', ['db/0001.sql', 'store.ts']),
    ];
    expect(groupTasks(tasks, 1)).toEqual([['T1'], ['T2']]);
  });

  it('never groups tasks from different repos', () => {
    const tasks = [
      task('T1', ['a.ts'], { repo: '/one' }),
      task('T2', ['b.ts'], { repo: '/two' }),
      task('T3', ['c.ts'], { repo: '/one' }),
    ];
    expect(groupTasks(tasks, 1)).toEqual([['T1', 'T3'], ['T2']]);
  });
});

describe('groupAnswer', () => {
  it('takes the highest demand of its tasks', () => {
    const answers = new Map([
      ['T1', answer({ reasoning: { mean: 4.5, confidence: 0.8 } })],
      ['T2', answer({ coding: { mean: 3.5, confidence: 0.7 }, reliability: 0.7 })],
    ]);
    expect(groupAnswer(['T1', 'T2'], answers)).toMatchObject({
      reasoning: { mean: 4.5, confidence: 0.8 },
      coding: { mean: 3.5, confidence: 0.7 },
      context: { mean: 2, confidence: 0.9 },
      reliability: 0.7,
    });
    expect(groupAnswer(['T9'], answers)).toBeNull();
  });

  it('keeps the riskier kind, so a mixed group is not clearly simple', () => {
    const docs = answer({
      kind: { choice: 'docs', confidence: 0.95, probabilities: { docs: 0.95 } },
    });
    const migrate = answer({
      kind: { choice: 'migrate', confidence: 0.6, probabilities: { migrate: 0.6 } },
    });
    expect(foldAnswer(docs, answer()).kind).toMatchObject({ choice: 'implement' });
    expect(foldAnswer(answer(), migrate).kind).toMatchObject({ choice: 'migrate' });
    expect(foldAnswer(docs, docs).kind).toMatchObject({ choice: 'docs' });
    expect(foldAnswer(answer({ kind: 'missing-answer' }), docs).kind).toMatchObject({
      choice: 'docs',
    });
  });
});
