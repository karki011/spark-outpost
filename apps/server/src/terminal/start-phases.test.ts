import { describe, expect, it, vi } from 'vitest';
import { startPhases } from './start-phases.ts';

describe('the phase a starting Terminal session is in', () => {
  it('is kept per chat and announced only when it changes', () => {
    const changed = vi.fn();
    const phases = startPhases(changed);
    expect(phases.get('a')).toBeNull();
    phases.set('a', 'preparing');
    phases.set('a', 'preparing');
    phases.set('a', 'worktree');
    phases.set('b', 'fetch');
    expect(phases.get('a')).toBe('worktree');
    expect(phases.get('b')).toBe('fetch');
    expect(changed.mock.calls).toEqual([['a'], ['a'], ['b']]);
  });

  it('clears when the start ends, and says so once', () => {
    const changed = vi.fn();
    const phases = startPhases(changed);
    phases.clear('a');
    phases.set('a', 'agent');
    phases.clear('a');
    phases.clear('a');
    expect(phases.get('a')).toBeNull();
    expect(changed.mock.calls).toEqual([['a'], ['a']]);
  });
});
