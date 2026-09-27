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
      need: null,
    });
  });

  it('keeps worktrees for manifests, lockfiles and generated files, not for config', () => {
    for (const file of ['package.json', 'pnpm-lock.yaml', 'src/api.gen.ts']) {
      const steps = [...STEPS.slice(0, 3), `Edit it\nFiles: ${file}`];
      expect(rulePlacement(steps, LANES)).toMatchObject({
        placement: 'worktree',
        need: 'sensitive files',
      });
    }
    const config = [...STEPS.slice(0, 3), 'Edit it\nFiles: tsconfig.json'];
    expect(rulePlacement(config, LANES).placement).toBe('shared');
    expect(sharedTreeBlocker('Cargo.lock')).toBe('a lockfile');
    expect(sharedTreeBlocker('dist/index.js')).toBe('a generated file');
    expect(sharedTreeBlocker('apps/web/vite.config.ts')).toBeNull();
    const steps = [...STEPS.slice(0, 3), 'Add a dependency\nFiles: package.json'];
    expect(sensitiveFiles(steps, LANES)).toEqual([{ file: 'package.json', kind: 'a manifest' }]);
  });
});

describe('who decides where lanes run', () => {
  it('never shares the tree when lanes overlap or a step lists no files', () => {
    const overlap = [...STEPS.slice(0, 3), 'Use the writer\nFiles: src/dates.ts, src/csv.ts'];
    expect(choosePlacement(overlap, LANES, sure)).toMatchObject({
      placement: 'worktree',
      need: 'overlapping files',
      reason: 'two lanes touch the same file',
      source: 'rules',
    });
    const vague = [...STEPS.slice(0, 3), 'Tidy up the helpers'];
    expect(choosePlacement(vague, LANES, sure, 'shared')).toMatchObject({
      placement: 'worktree',
      need: 'overlapping files',
      reason: 'step 4 does not list the files it changes',
    });
  });

  it('shares plain source lanes whatever Jev says', () => {
    for (const answer of [sure, against, unsure, silent]) {
      expect(choosePlacement(STEPS, LANES, answer)).toMatchObject({
        placement: 'shared',
        need: null,
        source: 'rules',
      });
    }
  });

  it('shares lanes that touch a manifest only when Jev is sure', () => {
    const manifest = [...STEPS.slice(0, 3), 'Add a dependency\nFiles: package.json'];
    const shared = choosePlacement(manifest, LANES, sure);
    expect(shared).toMatchObject({ placement: 'shared', source: 'jev', need: null });
    expect(shared.rule.placement).toBe('worktree');
    expect(choosePlacement(manifest, LANES, against)).toMatchObject({
      placement: 'worktree',
      need: 'sensitive files',
      reason: 'package.json is a manifest and Jev expects conflicts',
      source: 'jev',
    });
    expect(choosePlacement(manifest, LANES, unsure)).toMatchObject({
      reason: 'package.json is a manifest and Jev is unsure',
    });
    expect(choosePlacement(manifest, LANES, silent)).toMatchObject({
      placement: 'worktree',
      reason: 'package.json is a manifest and Jev did not answer',
      source: 'rules',
    });
  });

  it('keeps worktrees for destructive lanes and unattended Codex Builders, even when forced', () => {
    const plain = { destructive: false, unattendedCodex: false };
    expect(
      choosePlacement(STEPS, LANES, sure, 'shared', { ...plain, unattendedCodex: true }),
    ).toMatchObject({ placement: 'worktree', need: 'unattended Codex', source: 'rules' });
    expect(
      choosePlacement(STEPS, LANES, sure, 'jev', { ...plain, destructive: true }),
    ).toMatchObject({ placement: 'worktree', need: 'destructive work' });
    const dropping = [...STEPS.slice(0, 3), 'Drop the legacy table\nFiles: src/schema.sql'];
    expect(choosePlacement(dropping, LANES, sure, 'jev', plain)).toMatchObject({
      placement: 'worktree',
      need: 'destructive work',
    });
  });

  it('follows a forced option', () => {
    expect(choosePlacement(STEPS, LANES, sure, 'worktree')).toMatchObject({
      placement: 'worktree',
      need: 'requested',
      source: 'forced',
    });
    const manifest = [...STEPS.slice(0, 3), 'Add a dependency\nFiles: package.json'];
    expect(choosePlacement(manifest, LANES, against, 'shared')).toMatchObject({
      placement: 'shared',
      source: 'forced',
    });
  });
});
