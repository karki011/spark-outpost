import { describe, expect, it } from 'vitest';
import { parseViewedChat, sameChats, viewedChats, type ViewingState } from './chat-viewing.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const SHOWN = { focused: true, visible: true, minimized: false };

function state(overrides: Partial<ViewingState>): ViewingState {
  return { main: SHOWN, mainChat: CHAT, islandChat: null, ...overrides };
}

describe('viewedChats', () => {
  it('counts the chat open in the focused, visible main window', () => {
    expect(viewedChats(state({}))).toEqual([CHAT]);
  });

  it('does not count it while the window is unfocused, hidden or minimized', () => {
    expect(viewedChats(state({ main: { ...SHOWN, focused: false } }))).toEqual([]);
    expect(viewedChats(state({ main: { ...SHOWN, visible: false } }))).toEqual([]);
    expect(viewedChats(state({ main: { ...SHOWN, minimized: true } }))).toEqual([]);
  });

  it('counts the chat open in the island whatever the main window does', () => {
    const hidden = { focused: false, visible: false, minimized: false };
    expect(viewedChats(state({ main: hidden, islandChat: OTHER }))).toEqual([OTHER]);
    expect(viewedChats(state({ islandChat: CHAT }))).toEqual([CHAT]);
    expect(viewedChats(state({ islandChat: OTHER }))).toEqual([CHAT, OTHER]);
  });

  it('has nothing when no chat is open', () => {
    expect(viewedChats(state({ mainChat: null }))).toEqual([]);
  });
});

describe('parseViewedChat', () => {
  it('takes a chat id or null and refuses anything else', () => {
    expect(parseViewedChat(CHAT)).toBe(CHAT);
    expect(parseViewedChat(null)).toBeNull();
    expect(parseViewedChat('not-a-chat')).toBeUndefined();
    expect(parseViewedChat(42)).toBeUndefined();
  });
});

describe('sameChats', () => {
  it('ignores order', () => {
    expect(sameChats([CHAT, OTHER], [OTHER, CHAT])).toBe(true);
    expect(sameChats([CHAT], [CHAT, OTHER])).toBe(false);
  });
});
