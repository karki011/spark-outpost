import { describe, expect, it } from 'vitest';
import { projectRoot } from './task-facts.ts';

describe('the project a copied turn belongs to', () => {
  it('maps a worktree copy back to its project folder', () => {
    expect(projectRoot('/work/app/.spark/worktrees/0190-abc')).toBe('/work/app');
    expect(projectRoot('/work/app/.spark/worktrees/0190-abc/packages/web')).toBe('/work/app');
    expect(projectRoot('/work/app')).toBe('/work/app');
  });
});
