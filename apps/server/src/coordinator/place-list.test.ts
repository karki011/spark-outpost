import { describe, expect, it } from 'vitest';
import { forcedPlace } from './place-list.ts';

describe('a forced placement', () => {
  it('keeps the placement and says it was forced', () => {
    expect(forcedPlace('worktree')).toEqual({
      placement: 'worktree',
      reason: 'placement forced to worktrees by COORDINATOR_PLACEMENT',
    });
    expect(forcedPlace('shared').reason).toBe(
      'placement forced to the shared tree by COORDINATOR_PLACEMENT',
    );
  });
});
