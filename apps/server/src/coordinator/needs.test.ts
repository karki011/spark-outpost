import { describe, expect, it } from 'vitest';
import { neededFiles, needText, crossedText } from './needs.ts';

describe('neededFiles', () => {
  it('reads one need per line, with or without a bullet or backticks', () => {
    const reply = [
      'Added the store.',
      'Needs: `api.ts` — export listTags from the router',
      '- Needs: src/view.ts: show the tag count',
      'needs: README.md',
    ].join('\n');
    expect(neededFiles(reply)).toEqual([
      { path: 'api.ts', what: 'export listTags from the router' },
      { path: 'src/view.ts', what: 'show the tag count' },
      { path: 'README.md', what: '' },
    ]);
  });

  it('ignores prose, paths outside the project and repeats', () => {
    const reply = [
      'This needs: more thought.',
      'Needs: ../other/a.ts — nope',
      'Needs: /etc/hosts — nope',
      'Needs: a.ts — first',
      'Needs: a.ts — again',
    ].join('\n');
    expect(neededFiles(reply)).toEqual([{ path: 'a.ts', what: 'first' }]);
  });
});

describe('the text a follow-up is given', () => {
  it('names the worker, the file and the change', () => {
    expect(needText('Ada (P1)', { path: 'api.ts', what: 'export listTags' })).toBe(
      'Ada (P1) needs `api.ts` changed: export listTags',
    );
    expect(needText('P1', { path: 'api.ts', what: '' })).toContain(
      'the change its piece depends on',
    );
  });

  it('carries a kept change to another piece’s file as a diff, cut when it is long', () => {
    const patch = `+${'x'.repeat(5_000)}`;
    const text = crossedText('P2', 'api.ts', { patch, whole: false });
    expect(text).toContain('P2 changed `api.ts`, which your piece owns');
    expect(text).toContain('What it changed:');
    expect(text).toContain('[cut at 4000 characters]');
  });

  it('says so when the diff is the whole file’s and may hold the owner’s own changes', () => {
    const text = crossedText('P2', 'api.ts', { patch: '+a', whole: true });
    expect(text).toContain(
      'this is the whole diff of the file since P2 started; it can include your own changes:',
    );
    expect(text).not.toContain('What it changed:');
  });
});
