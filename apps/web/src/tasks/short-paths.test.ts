import { describe, expect, it } from 'vitest';
import { shortenPaths, shortPath } from './short-paths.ts';

const roots = ['/Users/me/code/app'];

describe('shortPath', () => {
  it('makes paths inside a linked repo relative', () => {
    expect(shortPath('/Users/me/code/app/src/format.ts', roots)).toBe('src/format.ts');
    expect(shortPath('/Users/me/code/app', roots)).toBe('.');
    expect(shortPath('/Users/me/code/app/', roots)).toBe('./');
  });

  it('prefers the deepest matching repo', () => {
    const nested = ['/Users/me/code', '/Users/me/code/app'];
    expect(shortPath('/Users/me/code/app/a.ts', nested)).toBe('a.ts');
  });

  it('keeps the last two segments of paths outside the repo', () => {
    expect(shortPath('/private/tmp/claude-501/scratch/live-crew/', roots)).toBe(
      '…/scratch/live-crew/',
    );
    expect(shortPath('/Users/me/code/application/x.ts', roots)).toBe('…/application/x.ts');
    expect(shortPath('/etc/hosts', roots)).toBe('/etc/hosts');
  });

  it('matches /private/tmp and /tmp as the same folder', () => {
    expect(shortPath('/private/tmp/repo/a.ts', ['/tmp/repo'])).toBe('a.ts');
    expect(shortPath('/tmp/repo/a.ts', ['/private/tmp/repo'])).toBe('a.ts');
  });
});

describe('shortenPaths', () => {
  it('shortens every absolute path in a command and leaves the rest alone', () => {
    expect(
      shortenPaths(
        'ls -la /private/tmp/claude-501/x/scratchpad/live-crew/ && cat /Users/me/code/app/README.md',
        roots,
      ),
    ).toBe('ls -la …/scratchpad/live-crew/ && cat README.md');
    expect(shortenPaths('grep -r "x" --include=/Users/me/code/app/src', roots)).toBe(
      'grep -r "x" --include=src',
    );
  });

  it('does not touch URLs, relative paths or plain text', () => {
    const text = 'curl https://example.com/a/b/c ./scripts/run.sh src/a.ts and/or';
    expect(shortenPaths(text, roots)).toBe(text);
  });
});
