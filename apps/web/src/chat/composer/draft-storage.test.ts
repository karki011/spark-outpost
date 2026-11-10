// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  loadDrafts,
  MAX_STORED_DRAFT_CHARS,
  MAX_STORED_DRAFTS,
  storeDraft,
} from './draft-storage.ts';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('stores, replaces and removes a draft', () => {
  storeDraft('a', 'one');
  storeDraft('b', 'two');
  storeDraft('a', 'three');
  expect([...loadDrafts()]).toEqual([
    ['b', 'two'],
    ['a', 'three'],
  ]);
  storeDraft('a', '');
  storeDraft('b', '');
  expect(localStorage.length).toBe(0);
});

it('drops the oldest drafts past the cap and clips long text', () => {
  for (let index = 0; index < MAX_STORED_DRAFTS + 5; index += 1) storeDraft(`chat-${index}`, 'x');
  const stored = loadDrafts();
  expect(stored.size).toBe(MAX_STORED_DRAFTS);
  expect(stored.has('chat-0')).toBe(false);
  expect(stored.has(`chat-${MAX_STORED_DRAFTS + 4}`)).toBe(true);
  storeDraft('long', 'y'.repeat(MAX_STORED_DRAFT_CHARS + 10));
  expect(loadDrafts().get('long')?.length).toBe(MAX_STORED_DRAFT_CHARS);
});

it('ignores malformed storage and unavailable storage', () => {
  localStorage.setItem('spark-outpost.drafts', '[1,2]');
  expect(loadDrafts().size).toBe(0);
  localStorage.setItem('spark-outpost.drafts', '{"a":5,"b":"ok","c":""}');
  expect([...loadDrafts()]).toEqual([['b', 'ok']]);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => storeDraft('a', 'text')).not.toThrow();
});

it('restores a draft after a reload, writes after a pause and clears when emptied', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const first = await import('./use-chat-draft.ts');
  const hook = renderHook(() => first.useChatDraft('persist-chat'));
  act(() => hook.result.current[1]('hello'));
  act(() => hook.result.current[1]('hello world'));
  expect(loadDrafts().has('persist-chat')).toBe(false);
  act(() => vi.advanceTimersByTime(500));
  expect(loadDrafts().get('persist-chat')).toBe('hello world');

  vi.resetModules();
  const second = await import('./use-chat-draft.ts');
  const reloaded = renderHook(() => second.useChatDraft('persist-chat'));
  expect(reloaded.result.current[0]).toBe('hello world');
  act(() => reloaded.result.current[1](''));
  expect(loadDrafts().has('persist-chat')).toBe(false);
});

it('flushes a pending draft when the page is hidden', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const module = await import('./use-chat-draft.ts');
  const hook = renderHook(() => module.useChatDraft('hide-chat'));
  act(() => hook.result.current[1]('unsaved'));
  window.dispatchEvent(new Event('pagehide'));
  expect(loadDrafts().get('hide-chat')).toBe('unsaved');
});
