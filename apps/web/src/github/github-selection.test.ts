import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupItems } from './github-model.ts';
import { initialPull, readRemembered, rememberOpen } from './github-selection.ts';
import { inboxItem } from './inbox-item-fixture.ts';

const grouped = groupItems([
  inboxItem({ id: 'a#1', updatedAt: '2026-11-14T00:00:00Z' }),
  inboxItem({ id: 'a#2', updatedAt: '2026-11-15T00:00:00Z' }),
  inboxItem({ id: 'a#3', group: 'waiting', updatedAt: '2026-11-16T00:00:00Z' }),
]);

function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

describe('which pull request the page opens on', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('opens the one last looked at, in any group', () => {
    expect(initialPull(grouped, { kind: 'open', id: 'a#3' })?.id).toBe('a#3');
  });

  it('falls back to the newest in the first group with anything in it', () => {
    expect(initialPull(grouped, { kind: 'none' })?.id).toBe('a#2');
    expect(initialPull(grouped, { kind: 'open', id: 'gone#9' })?.id).toBe('a#2');
  });

  it('stays closed after the panel was closed', () => {
    expect(initialPull(grouped, { kind: 'closed' })).toBeNull();
  });

  it('remembers the last choice on this computer', () => {
    expect(readRemembered()).toEqual({ kind: 'none' });
    rememberOpen('a#1');
    expect(readRemembered()).toEqual({ kind: 'open', id: 'a#1' });
    rememberOpen(null);
    expect(readRemembered()).toEqual({ kind: 'closed' });
  });

  it('carries on when storage is blocked', () => {
    const fail = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { ...fakeStorage(), getItem: fail, setItem: fail });
    expect(() => rememberOpen('a#1')).not.toThrow();
    expect(readRemembered()).toEqual({ kind: 'none' });
  });
});
