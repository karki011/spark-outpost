// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { cardKey, pendingCards, type Card } from './island-model.ts';
import { readSetAside, stillWaiting, useSetAside } from './set-aside.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function waiting(id: string, updatedAt = '2026-10-12T09:00:00.000Z'): ConversationSummary {
  return { id, title: id, updatedAt, archivedAt: null, needsInput: true } as ConversationSummary;
}

function card(chatId: string, approvalId: string | null, loading = false): Card {
  return {
    kind: 'approval',
    chat: waiting(chatId),
    approval: approvalId ? ({ id: approvalId } as Approval) : null,
    loading,
  };
}

describe('setting a request aside', () => {
  it('keeps the request aside across an island reload', () => {
    const cards = [card('a', 'one'), card('b', 'two')];
    const first = renderHook(() => useSetAside(cards));
    act(() => first.result.current.setAside(cards[0]!));
    expect([...first.result.current.keys]).toEqual(['one']);
    first.unmount();
    const reloaded = renderHook(() => useSetAside(cards));
    expect([...reloaded.result.current.keys]).toEqual(['one']);
  });

  it('brings a chat-level request back once the chat changes', () => {
    const chats = [waiting('a')];
    const noApprovals = new Map([['a', []]]);
    const [before] = pendingCards(chats, noApprovals, new Set());
    const aside = new Set([cardKey(before!)]);
    expect(pendingCards(chats, noApprovals, aside)).toEqual([]);
    const changed = [waiting('a', '2026-10-12T09:05:00.000Z')];
    expect(pendingCards(changed, noApprovals, aside)).toHaveLength(1);
  });

  it('forgets requests that are no longer waiting when the next one is set aside', () => {
    localStorage.setItem('spark-outpost.island.set-aside', JSON.stringify(['gone', 'one']));
    const cards = [card('a', 'one'), card('b', 'two')];
    const hook = renderHook(() => useSetAside(cards));
    act(() => hook.result.current.setAside(cards[1]!));
    expect(readSetAside()).toEqual(['one', 'two']);
  });

  it('forgets nothing while a request is still loading', () => {
    expect(stillWaiting(['one', 'later'], [card('a', 'one'), card('b', null, true)])).toEqual([
      'one',
      'later',
    ]);
  });

  it('works without storage and ignores a damaged entry', () => {
    localStorage.setItem('spark-outpost.island.set-aside', '{"not":"a list"');
    expect(readSetAside()).toEqual([]);
    localStorage.setItem('spark-outpost.island.set-aside', JSON.stringify(['one', 2, null]));
    expect(readSetAside()).toEqual(['one']);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const cards = [card('a', 'one')];
    const hook = renderHook(() => useSetAside(cards));
    act(() => hook.result.current.setAside(cards[0]!));
    expect([...hook.result.current.keys]).toEqual(['one']);
  });
});
