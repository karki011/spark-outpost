import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { attentionKey, nextToExpand, opensByItself } from './auto-expand.ts';
import { islandView, type Card } from './island-model.ts';

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

describe('resting as blobs with requests opening by themselves', () => {
  const rest = { note: false, panel: null, review: null, nudge: true, hoverOnly: true };

  it('rests as blobs at every size until a request opens, and again once it is put away', () => {
    const request = card('a', 'one');
    const shown = new Set<string>();
    for (const full of [true, false]) {
      expect(islandView({ ...rest, full, cards: [] })).toEqual({ kind: 'peek' });
      expect(islandView({ ...rest, full, cards: [request] })).toEqual({ kind: 'peek' });
    }
    const opened = nextToExpand([request], [request], shown);
    expect(islandView({ ...rest, cards: [request], review: opened!.chat.id }).kind).toBe('card');
    expect(islandView({ ...rest, cards: [request] })).toEqual({ kind: 'peek' });
    expect(nextToExpand([], [request], shown)).toBeNull();
    expect(islandView({ ...rest, cards: [] })).toEqual({ kind: 'peek' });
  });

  it('opens a request only from the resting blobs, never over Spark, a drag or an open view', () => {
    const request = card('a', 'one');
    const blobs = islandView({ ...rest, cards: [request] });
    const calm = { sparkFocused: false, dragging: false };
    expect(opensByItself(blobs, calm)).toBe(true);
    expect(opensByItself(blobs, { ...calm, sparkFocused: true })).toBe(false);
    expect(opensByItself(blobs, { ...calm, dragging: true })).toBe(false);
    expect(opensByItself(islandView({ ...rest, cards: [request], panel: 'home' }), calm)).toBe(
      false,
    );
    expect(opensByItself(islandView({ ...rest, cards: [request], review: 'a' }), calm)).toBe(false);
    expect(opensByItself(islandView({ ...rest, cards: [request], note: true }), calm)).toBe(false);
  });
});
