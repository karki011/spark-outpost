import { describe, expect, it } from 'vitest';
import { API_CHAT, FE_CHAT, chat } from '../outposts/test-fixtures.ts';
import type { Card } from './island-model.ts';
import { acknowledged, islandViewedChat, unacknowledged } from './use-island-viewing.ts';

const NONE: ReadonlySet<string> = new Set();

function card(chatId: string): Card {
  return { kind: 'open', chat: chat(chatId, { needsInput: true }), approval: null, loading: false };
}

const fe = card(FE_CHAT);
const api = card(API_CHAT);

describe('acknowledged', () => {
  it('marks the requests of a chat the user opens as seen', () => {
    const seen = acknowledged(NONE, [fe, api], new Set([FE_CHAT]));
    expect(unacknowledged([fe, api], seen, NONE)).toEqual([api]);
  });

  it('keeps them seen after the user moves on, so the island does not nag again', () => {
    const seen = acknowledged(NONE, [fe], new Set([FE_CHAT]));
    const later = acknowledged(seen, [fe, api], NONE);
    expect(unacknowledged([fe, api], later, NONE)).toEqual([api]);
  });

  it('forgets requests that are no longer waiting', () => {
    const seen = acknowledged(NONE, [fe], new Set([FE_CHAT]));
    expect(acknowledged(seen, [], NONE).size).toBe(0);
  });

  it('returns the same set when nothing changed', () => {
    const seen = acknowledged(NONE, [fe], new Set([FE_CHAT]));
    expect(acknowledged(seen, [fe], NONE)).toBe(seen);
  });
});

describe('unacknowledged', () => {
  it('hides the requests of a chat being viewed right now', () => {
    expect(unacknowledged([fe, api], NONE, new Set([API_CHAT]))).toEqual([fe]);
  });
});

describe('islandViewedChat', () => {
  const quiet = { review: null, selfOpened: null, focusSignal: 0 };

  it('counts a card the user opened', () => {
    expect(islandViewedChat({ ...quiet, review: FE_CHAT })).toBe(FE_CHAT);
    expect(islandViewedChat(quiet)).toBeNull();
  });

  it('does not count a card the island opened by itself until the user takes it', () => {
    const selfOpened = { ...quiet, review: FE_CHAT, selfOpened: FE_CHAT };
    expect(islandViewedChat(selfOpened)).toBeNull();
    expect(islandViewedChat({ ...selfOpened, focusSignal: 1 })).toBe(FE_CHAT);
    expect(islandViewedChat({ ...selfOpened, selfOpened: null })).toBe(FE_CHAT);
  });
});
