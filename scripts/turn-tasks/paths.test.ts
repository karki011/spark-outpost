import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUTPUT_ROOT, WORKTREE_ROOT, assertScratchPath, isInside, scratchBase } from './paths.ts';

describe('scratch paths', () => {
  it('keeps the scratch base under the system temp folder', () => {
    expect(assertScratchPath(scratchBase())).toBe(scratchBase());
    expect(assertScratchPath(join(tmpdir(), 'spark-turn-tasks', 'runs', 'a'))).toContain(
      'spark-turn-tasks',
    );
  });

  it('places a path whose folders do not exist yet under the real temp folder', () => {
    const missing = join(tmpdir(), 'spark-turn-tasks-missing', 'not', 'made', 'yet');
    expect(assertScratchPath(missing)).toBe(
      join(realpathSync(tmpdir()), 'spark-turn-tasks-missing', 'not', 'made', 'yet'),
    );
  });

  it('refuses the temp folder itself, the home folder and any repository outside temp', () => {
    expect(() => assertScratchPath(tmpdir())).toThrow('system temp folder');
    expect(() => assertScratchPath(homedir())).toThrow('system temp folder');
    expect(() => assertScratchPath(WORKTREE_ROOT)).toThrow('system temp folder');
    expect(() => assertScratchPath(join(homedir(), 'Documents', 'orders-web-app'))).toThrow(
      'system temp folder',
    );
  });

  it('writes results inside the ignored .local folder of this checkout', () => {
    expect(isInside(join(WORKTREE_ROOT, '.local'), OUTPUT_ROOT)).toBe(true);
  });

  it('does not treat a sibling with the same prefix as inside', () => {
    expect(isInside('/tmp/a', '/tmp/ab')).toBe(false);
    expect(isInside('/tmp/a', '/tmp/a/b')).toBe(true);
  });
});
