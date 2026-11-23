import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './task-facts.ts';

describe('the project a copied turn belongs to', () => {
  it('maps a worktree copy back to its project folder', () => {
    const app = join('/work', 'app');
    expect(projectRoot(join(app, '.spark', 'worktrees', '0190-abc'))).toBe(app);
    expect(projectRoot(join(app, '.spark', 'worktrees', '0190-abc', 'packages', 'web'))).toBe(app);
    expect(projectRoot(app)).toBe(app);
  });
});
