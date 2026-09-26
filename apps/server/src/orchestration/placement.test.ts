import { describe, expect, it } from 'vitest';
import { noulVerdict } from './parallel-choice.ts';
import { choosePlacement, rulePlacement, sensitiveFiles, sharedTreeBlocker } from './placement.ts';

const STEPS = [
  'Create the CSV writer\nFiles: src/csv.ts, test/csv.test.ts',
  'Add reportCsv\nFiles: src/report.ts',
  'Create reminders\nFiles: src/reminders.ts, test/reminders.test.ts',
  'Add daysBetween\nFiles: src/dates.ts',
];
const LANES = [
  [0, 1],
  [2, 3],
];
const sure = { answered: true, verdict: noulVerdict(0.92) };
const against = { answered: true, verdict: noulVerdict(0.1) };
const unsure = { answered: true, verdict: noulVerdict(0.6) };
const silent = { answered: false, verdict: null };

describe('the placement rule', () => {
  it('shares the tree when lanes change separate, listed source files', () => {
    expect(rulePlacement(STEPS, LANES)).toEqual({
      placement: 'shared',
      reason: 'lanes change separate source files',
    });
  });

  it('keeps worktrees for manifests, lockfiles, config and generated files', () => {
    for (const file of ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'src/api.gen.ts']) {
      const steps = [...STEPS.slice(0, 3), `Edit it\nFiles: ${file}`];
      expect(rulePlacement(steps, LANES).placement).toBe('worktree');
    }
    expect(sharedTreeBlocker('apps/web/vite.config.ts')).toBe('a config file');
    expect(sharedTreeBlocker('Cargo.lock')).toBe('a lockfile');
    expect(sharedTreeBlocker('dist/index.js')).toBe('a generated file');
    expect(sharedTreeBlocker('src/config.ts')).toBeNull();
    const steps = [...STEPS.slice(0, 3), 'Add a dependency\nFiles: package.json'];
    expect(sensitiveFiles(steps, LANES)).toEqual([{ file: 'package.json', kind: 'a manifest' }]);
  });
});

describe('who decides where lanes run', () => {
  it('never shares the tree when lanes overlap or a step lists no files', () => {
    const overlap = [...STEPS.slice(0, 3), 'Use the writer\nFiles: src/dates.ts, src/csv.ts'];
    expect(choosePlacement(overlap, LANES, sure)).toMatchObject({
      placement: 'worktree',
      reason: 'two lanes touch the same file',
      source: 'rules',
    });
    const vague = [...STEPS.slice(0, 3), 'Tidy up the helpers'];
    expect(choosePlacement(vague, LANES, sure, 'shared')).toMatchObject({
      placement: 'worktree',
      reason: 'step 4 does not list the files it changes',
    });
  });

  it('shares only when Jev is sure, even when the manifest rule says worktrees', () => {
    const manifest = [...STEPS.slice(0, 3), 'Add a dependency\nFiles: package.json'];
    const shared = choosePlacement(manifest, LANES, sure);
    expect(shared).toMatchObject({ placement: 'shared', source: 'jev' });
    expect(shared.rule.placement).toBe('worktree');
    expect(choosePlacement(STEPS, LANES, against)).toMatchObject({
      placement: 'worktree',
      reason: 'Jev expects conflicts',
    });
    expect(choosePlacement(STEPS, LANES, unsure)).toMatchObject({
      placement: 'worktree',
      reason: 'Jev is unsure',
    });
  });

  it('falls back to the rule without Jev and follows a forced option', () => {
    expect(choosePlacement(STEPS, LANES, silent)).toMatchObject({
      placement: 'shared',
      source: 'rules',
    });
    expect(choosePlacement(STEPS, LANES, sure, 'worktree')).toMatchObject({
      placement: 'worktree',
      source: 'forced',
    });
  });
});
