import { describe, expect, it } from 'vitest';
import { noulVerdict } from './parallel-choice.ts';
import {
  chainsFromReply,
  chooseLanes,
  dependencies,
  largeLane,
  lanesFromDependencies,
  stepNotesFromReply,
  withFilesLines,
} from './chains.ts';

const P1_STEPS = [
  'CSV export: create src/csv.ts with entriesToCsv',
  'Add reportCsv to src/report.ts',
  'Add tests in test/csv.test.ts',
  'Reminders: create src/reminders.ts with reminderText',
  'Add daysBetween to src/dates.ts',
  'Add tests in test/reminders.test.ts',
];

const P1_REPLY = `Two independent features.

Step 1 · Files: src/csv.ts · Depends on: none
Step 2 · Files: src/report.ts · Depends on: 1
Step 3 · Files: test/csv.test.ts · Depends on: 1, 2
Step 4 · Files: src/reminders.ts · Depends on: none
Step 5 · Files: src/dates.ts · Depends on: 4
Step 6 · Files: test/reminders.test.ts · Depends on: steps 4-5
Chain A: steps 1-3
Chain B: steps 4-6`;

describe('reading the Architect’s reply', () => {
  it('takes each step’s files and dependencies by its number', () => {
    const notes = stepNotesFromReply(P1_REPLY, 6);
    expect(notes.files).toEqual([
      ['src/csv.ts'],
      ['src/report.ts'],
      ['test/csv.test.ts'],
      ['src/reminders.ts'],
      ['src/dates.ts'],
      ['test/reminders.test.ts'],
    ]);
    expect(notes.depends).toEqual([[], [0], [0, 1], [], [3], [3, 4]]);
    expect(withFilesLines(P1_STEPS, notes)[1]).toBe(
      'Add reportCsv to src/report.ts\nFiles: src/report.ts',
    );
    expect(withFilesLines(['Edit a\nFiles: a.ts'], notes)[0]).toBe('Edit a\nFiles: a.ts');
  });

  it('reads numbered lines, bold step labels and "none" answers', () => {
    const notes = stepNotesFromReply(
      '1. Add the helper — Files: `src/a.ts`, src/b.ts\n**Step 2**: depends on 1; Files: none',
      2,
    );
    expect(notes.files).toEqual([['src/a.ts', 'src/b.ts'], []]);
    expect(notes.depends).toEqual([null, [0]]);
  });

  it('reads chain lines with ranges and lists, ignoring repeated steps', () => {
    expect(chainsFromReply(P1_REPLY, 6)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(chainsFromReply('- Chain A (CSV): 1, 2\n- Chain B: steps 2 to 3', 3)).toEqual([
      [0, 1],
      [2],
    ]);
    expect(chainsFromReply('Chain A: steps 1-3', 3)).toEqual([]);
  });
});

describe('planning in chains', () => {
  it('gives two independent feature chains their own lanes only when they are large', () => {
    const notes = stepNotesFromReply(P1_REPLY, 6);
    const steps = withFilesLines(P1_STEPS, notes);
    const inputs = { steps, chains: chainsFromReply(P1_REPLY, 6), depends: notes.depends };
    const lanes = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    expect(chooseLanes({ ...inputs, large: [] })).toEqual([]);
    expect(chooseLanes({ ...inputs, large: [0, 1, 3, 5] })).toEqual(lanes);
    expect(chooseLanes({ ...inputs, large: [], split: 'any' })).toEqual(lanes);
  });

  it('counts a lane that changes five or more files as large', () => {
    const steps = [
      'Edit\nFiles: src/a.ts, src/b.ts, src/c.ts',
      'Edit\nFiles: src/d.ts, src/e.ts',
      'Edit\nFiles: src/f.ts',
      'Edit\nFiles: src/g.ts',
    ];
    const inputs = {
      steps,
      chains: [
        [0, 1],
        [2, 3],
      ],
      depends: [null, null, null, null],
    };
    expect(largeLane({ ...inputs, large: [] }, [0, 1])).toBe(true);
    expect(largeLane({ ...inputs, large: [] }, [2, 3])).toBe(false);
    expect(
      largeLane({ ...inputs, large: [2], sizes: [null, null, null, noulVerdict(0.9)] }, [2, 3]),
    ).toBe(true);
    expect(
      largeLane({ ...inputs, large: [2, 3], sizes: [null, null, noulVerdict(0.1), null] }, [2, 3]),
    ).toBe(false);
  });

  it('keeps shared setup before the lanes and a joining step after them', () => {
    const depends = [[], [0], [1], [0], [3], [2, 4]];
    expect(lanesFromDependencies(depends)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(lanesFromDependencies([[], [0], [1]])).toEqual([]);
  });

  it('treats unlisted steps as needing earlier ones and defaults to the previous step', () => {
    expect(dependencies(4, [[0], [2, 3]], [null, null, null, null])).toEqual([[], [0], [], [2]]);
    expect(dependencies(3, [], [[], null, null])).toEqual([[], [0], [1]]);
    expect(dependencies(3, [], [null, null, null])).toBeNull();
  });

  it('merges lanes that change the same file or that Jev is sure depend on each other', () => {
    const steps = ['Edit src/a.ts\nFiles: src/a.ts', 'Edit src/b.ts\nFiles: src/b.ts, src/a.ts'];
    expect(chooseLanes({ steps, chains: [[0], [1]], depends: [[], []], large: [0, 1] })).toEqual(
      [],
    );
    const apart = ['Edit src/a.ts\nFiles: src/a.ts', 'Edit src/b.ts\nFiles: src/b.ts'];
    const inputs = { steps: apart, chains: [[0], [1]], depends: [[], []], large: [0, 1] };
    expect(chooseLanes(inputs)).toEqual([[0], [1]]);
    expect(chooseLanes({ ...inputs, independent: [noulVerdict(0.05)] })).toEqual([]);
  });

  it('only gives a one-step lane its own Builder when the step is large', () => {
    const steps = [
      'Edit src/a.ts\nFiles: src/a.ts',
      'Edit src/b.ts\nFiles: src/b.ts',
      'Edit src/c.ts\nFiles: src/c.ts',
    ];
    const base = { steps, chains: [[0, 1], [2]], depends: [null, null, null], large: [0, 1] };
    expect(chooseLanes(base)).toEqual([]);
    expect(chooseLanes({ ...base, large: [0, 1, 2] })).toEqual([[0, 1], [2]]);
    expect(chooseLanes({ ...base, sizes: [null, null, noulVerdict(0.95)] })).toEqual([[0, 1], [2]]);
  });

  it('leaves research plans and long plans to the older rules', () => {
    const steps = ['Research: how dates work', 'Edit src/b.ts', 'Edit src/c.ts'];
    expect(chooseLanes({ steps, chains: [[0, 1], [2]], depends: [], large: [0, 1, 2] })).toEqual(
      [],
    );
    const long = Array.from({ length: 13 }, (_, index) => `Edit src/f${index}.ts`);
    expect(chooseLanes({ steps: long, chains: [[0], [1]], depends: [], large: [] })).toEqual([]);
  });
});
