import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.ts';
import { readHomeDraftId, saveHomeDraftId } from './home-draft.ts';

const SAVED = '3f6c1a52-8a0e-4c1b-9a51-7d0f6d2b9e10';

function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('blocked');
  };
  return { ...fakeStorage(), getItem: fail, setItem: fail };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe('Home draft id', () => {
  it('keeps the same draft across reloads', () => {
    const first = readHomeDraftId();
    expect(readHomeDraftId()).toBe(first);
  });

  it('switches to the draft saved after a send', () => {
    readHomeDraftId();
    saveHomeDraftId(SAVED);
    expect(readHomeDraftId()).toBe(SAVED);
  });

  it('starts a fresh draft when the saved value is not a draft id', () => {
    localStorage.setItem('spark-outpost.home-draft', 'not-an-id');
    const id = readHomeDraftId();
    expect(id).not.toBe('not-an-id');
    expect(readHomeDraftId()).toBe(id);
  });

  it('still gives a draft id when storage is blocked', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    expect(readHomeDraftId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => saveHomeDraftId(SAVED)).not.toThrow();
  });

  it("asks the server for a kept draft's picks", async () => {
    saveHomeDraftId(SAVED);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('{}', { status: 500 });
      }),
    );
    await api.getConversation(readHomeDraftId()).catch(() => null);
    expect(calls).toContain(`/api/conversations/${SAVED}`);
  });
});
