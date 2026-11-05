import { describe, expect, it } from 'vitest';
import { FE_CHAT } from '../outposts/test-fixtures.ts';
import { islandViewedChat } from './use-island-viewing.ts';

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
