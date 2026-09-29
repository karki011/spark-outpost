import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDetailsOpen, writeDetailsOpen } from './digest-details.ts';

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('digest details preference', () => {
  it('defaults to closed the first time', () => {
    expect(readDetailsOpen()).toBe(false);
  });

  it('remembers an opened choice', () => {
    writeDetailsOpen(true);
    expect(readDetailsOpen()).toBe(true);
  });

  it('remembers a closed choice', () => {
    writeDetailsOpen(true);
    writeDetailsOpen(false);
    expect(readDetailsOpen()).toBe(false);
  });

  it('falls back to closed when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readDetailsOpen()).toBe(false);
  });

  it('does not throw when storage is unwritable', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => writeDetailsOpen(false)).not.toThrow();
  });
});
