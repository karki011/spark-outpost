import { describe, expect, it } from 'vitest';
import { neededFiles, needText, revertedText } from './needs.ts';

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

  it('carries a reverted change as a diff, cut when it is long', () => {
    const text = revertedText('P2', 'api.ts', `+${'x'.repeat(5_000)}`);
    expect(text).toContain('P2 changed `api.ts`, which it does not own');
    expect(text).toContain('[cut at 4000 characters]');
  });
});
