import { describe, expect, it } from 'vitest';
import { advance, CONNECTING, parseProgressLine } from './clone-progress.ts';

describe('git clone progress', () => {
  it.each([
    ['remote: Counting objects: 100% (12/12), done.', 'Preparing on the server', 5],
    ['Receiving objects:   0% (1/2000)', 'Receiving objects', 5],
    ['Receiving objects:  48% (960/2000), 1.20 MiB | 2.00 MiB/s', 'Receiving objects', 41],
    ['Receiving objects: 100% (2000/2000), done.', 'Receiving objects', 80],
    ['Resolving deltas:  50% (10/20)', 'Resolving deltas', 88],
    ['Updating files: 100% (300/300), done.', 'Checking out files', 100],
  ])('reads %s', (line, phase, percent) => {
    expect(parseProgressLine(line)).toEqual({ phase, percent });
  });

  it.each(["Cloning into '/tmp/x'...", 'remote: Total 12 (delta 0)', '', 'fatal: nope'])(
    'ignores %j',
    (line) => {
      expect(parseProgressLine(line)).toBeNull();
    },
  );

  it('never moves backwards', () => {
    const receiving = advance(CONNECTING, 'Receiving objects:  60% (6/10)');
    expect(advance(receiving, 'remote: Compressing objects:  10% (1/10)')).toBe(receiving);
    expect(advance(receiving, 'Resolving deltas:   0% (0/4)').phase).toBe('Resolving deltas');
  });
});
