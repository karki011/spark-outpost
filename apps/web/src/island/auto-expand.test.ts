import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { attentionKey, nextToExpand } from './auto-expand.ts';
import type { Card } from './island-model.ts';

function card(chatId: string, approvalId: string | null, loading = false): Card {
  return {
    kind: 'approval',
    chat: { id: chatId, updatedAt: '2026-01-01T00:00:00Z' } as ConversationSummary,
    approval: approvalId ? ({ id: approvalId } as Approval) : null,
    loading,
  };
}

describe('opening a request by itself', () => {
  it('opens each request once, oldest first', () => {
    const shown = new Set<string>();
    const cards = [card('a', 'one'), card('b', 'two')];
    expect(nextToExpand(cards, cards, shown)?.chat.id).toBe('a');
    expect(nextToExpand(cards, cards, shown)?.chat.id).toBe('b');
    expect(nextToExpand(cards, cards, shown)).toBeNull();
  });

  it('does not reopen a request the user put aside, even when the chat changes', () => {
    const shown = new Set<string>();
    const first = card('a', null);
    expect(nextToExpand([first], [first], shown)).toBe(first);
    const touched = { ...first, chat: { ...first.chat, updatedAt: '2026-01-02T00:00:00Z' } };
    expect(nextToExpand([touched], [touched], shown)).toBeNull();
    expect(nextToExpand([], [touched], shown)).toBeNull();
    expect(nextToExpand([touched], [touched], shown)).toBeNull();
  });

  it('opens again when the same chat asks something new', () => {
    const shown = new Set<string>();
    const first = card('a', null);
    nextToExpand([first], [first], shown);
    expect(nextToExpand([], [], shown)).toBeNull();
    expect(nextToExpand([first], [first], shown)).toBe(first);
    const followUp = card('a', 'next');
    expect(nextToExpand([followUp], [followUp], shown)).toBe(followUp);
  });

  it('waits until the request has loaded', () => {
    const shown = new Set<string>();
    const loading = card('a', null, true);
    expect(nextToExpand([loading], [loading], shown)).toBeNull();
    expect(shown.size).toBe(0);
    expect(attentionKey(card('a', 'one'))).toBe('one');
  });
});
