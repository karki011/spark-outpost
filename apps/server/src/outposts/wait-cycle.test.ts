import { describe, expect, it } from 'vitest';
import { wouldDeadlock, type OpenWait } from './wait-cycle.ts';

const wait = (from: string, to: string): OpenWait => ({ from, to });

describe('whether a waiting ask would deadlock', () => {
  it('lets a chat wait when nobody waits on it', () => {
    expect(wouldDeadlock('web', 'api', [])).toBe(false);
    expect(wouldDeadlock('web', 'api', [wait('docs', 'api')])).toBe(false);
  });

  it('refuses a wait on a chat that already waits on the asker', () => {
    expect(wouldDeadlock('web', 'api', [wait('api', 'web')])).toBe(true);
  });

  it('refuses a wait that closes a longer ring', () => {
    const open = [wait('api', 'docs'), wait('docs', 'web')];
    expect(wouldDeadlock('web', 'api', open)).toBe(true);
  });

  it('lets a chat wait on one that waits on a third chat', () => {
    expect(wouldDeadlock('web', 'api', [wait('api', 'docs')])).toBe(false);
  });

  it('refuses a chat waiting on itself', () => {
    expect(wouldDeadlock('web', 'web', [])).toBe(true);
  });

  it('ends on open waits that already form a ring elsewhere', () => {
    const open = [wait('api', 'docs'), wait('docs', 'api')];
    expect(wouldDeadlock('web', 'api', open)).toBe(false);
  });
});
