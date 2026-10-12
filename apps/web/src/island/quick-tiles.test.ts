import { describe, expect, it } from 'vitest';
import { needsYou, startTiles } from './quick-tiles.ts';

describe('the quick start tiles', () => {
  it('puts the project on its own line so the action is never cut short', () => {
    const [first] = startTiles('feature-web-apps', true);
    expect(first).toMatchObject({
      name: 'New chat',
      sub: 'feature-web-apps',
      hint: 'New chat in feature-web-apps',
    });
    expect(startTiles(null, true)[0]).toMatchObject({ sub: null, hint: 'New chat' });
  });

  it('offers a new Spark where settings can open, and all chats where they cannot', () => {
    expect(startTiles(null, true).map((tile) => tile.id)).toEqual(['new', 'ask', 'make']);
    expect(startTiles(null, false).map((tile) => tile.name)).toEqual([
      'New chat',
      'Ask Spark',
      'All chats',
    ]);
  });
});

describe('the Needs you status', () => {
  it('is nothing to act on when no chat waits', () => {
    expect(needsYou(0)).toBeNull();
  });

  it('counts the waiting chats and says what it opens', () => {
    expect(needsYou(1)).toEqual({
      count: 1,
      sub: 'Opens Chats',
      label: 'Needs you: 1 chat is waiting. Opens the Chats tab',
    });
    expect(needsYou(3)).toMatchObject({ count: 3, label: expect.stringContaining('3 chats are') });
  });
});
