import { describe, expect, it } from 'vitest';
import { CHAT_LIST_PAGE, type ConversationSummary } from '@spark-outpost/contracts';
import {
  NO_SPLIT,
  closePane,
  focusPane,
  leaveChat,
  openBeside,
  parseSplit,
  restoredSplit,
  showChat,
  type ChatSplit,
} from './chat-split.ts';

const PAIR: ChatSplit = { primary: 'a', secondary: 'b', focus: 'primary', ratio: 0.5 };

function summary(id: string, archivedAt: string | null = null): ConversationSummary {
  return { id, archivedAt } as ConversationSummary;
}

describe('showChat', () => {
  it('opens the chat as the only one when there is no split', () => {
    expect(showChat(NO_SPLIT, 'a', false)).toMatchObject({ primary: 'a', secondary: null });
  });

  it('replaces the chat in the focused pane', () => {
    expect(showChat(PAIR, 'c', false)).toMatchObject({ primary: 'c', secondary: 'b' });
    const right = { ...PAIR, focus: 'secondary' as const };
    expect(showChat(right, 'c', false)).toMatchObject({ primary: 'a', secondary: 'c' });
  });

  it('focuses the pane that already shows the chat instead of showing it twice', () => {
    expect(showChat(PAIR, 'b', false)).toEqual({ ...PAIR, focus: 'secondary' });
    expect(showChat(PAIR, 'a', false)).toBe(PAIR);
  });

  it('keeps the pair for later while the window is too narrow for two chats', () => {
    expect(showChat(PAIR, 'c', true)).toEqual({ ...PAIR, primary: 'c' });
    expect(showChat(PAIR, 'b', true)).toMatchObject({ primary: 'b', secondary: null });
  });
});

describe('openBeside', () => {
  it('opens a second pane beside the chat on screen and focuses it', () => {
    expect(openBeside(NO_SPLIT, 'b', 'a')).toEqual({ ...PAIR, focus: 'secondary' });
  });

  it('replaces the pane the user is not in', () => {
    expect(openBeside(PAIR, 'c', 'a')).toMatchObject({ secondary: 'c', focus: 'secondary' });
    const right = { ...PAIR, focus: 'secondary' as const };
    expect(openBeside(right, 'c', 'a')).toMatchObject({
      primary: 'c',
      secondary: 'b',
      focus: 'primary',
    });
  });

  it('only focuses a chat that is already on screen', () => {
    expect(openBeside(NO_SPLIT, 'a', 'a')).toMatchObject({ primary: 'a', secondary: null });
    expect(openBeside(PAIR, 'b', 'a')).toEqual({ ...PAIR, focus: 'secondary' });
  });
});

describe('closing', () => {
  it('closes the second pane and keeps the first', () => {
    expect(closePane({ ...PAIR, focus: 'secondary' }, 'secondary')).toEqual({
      ...PAIR,
      secondary: null,
    });
  });

  it('keeps the other chat when the first pane closes', () => {
    expect(closePane(PAIR, 'primary')).toMatchObject({ primary: 'b', secondary: null });
  });

  it('leaves the split when either chat is archived or deleted', () => {
    expect(leaveChat(PAIR, 'b')).toMatchObject({ primary: 'a', secondary: null });
    expect(leaveChat(PAIR, 'a')).toMatchObject({ primary: 'b', secondary: null });
    expect(leaveChat(PAIR, 'c')).toBeNull();
    expect(leaveChat(NO_SPLIT, 'a')).toBeNull();
  });

  it('does not focus a pane that is not there', () => {
    expect(focusPane(NO_SPLIT, 'secondary')).toBe(NO_SPLIT);
  });
});

describe('a saved split', () => {
  it('reads back the pair, focus and divider', () => {
    expect(parseSplit({ ...PAIR, focus: 'secondary', ratio: 0.3 })).toEqual({
      ...PAIR,
      focus: 'secondary',
      ratio: 0.3,
    });
  });

  it('keeps only the divider when the pair is missing or broken', () => {
    expect(parseSplit({ ratio: 0.4 })).toEqual({ ...NO_SPLIT, ratio: 0.4 });
    expect(parseSplit({ primary: 'a', secondary: 'a', ratio: 2 })).toEqual({
      ...NO_SPLIT,
      ratio: 0.85,
    });
    expect(parseSplit({ primary: 7, secondary: 'b' })).toEqual(NO_SPLIT);
    expect(parseSplit('nonsense')).toEqual(NO_SPLIT);
  });

  it('drops a chat that is gone or archived since', () => {
    const chats = [summary('a'), summary('b')];
    expect(restoredSplit(PAIR, chats)).toBe(PAIR);
    expect(restoredSplit(PAIR, [summary('a')])).toMatchObject({ primary: 'a', secondary: null });
    expect(
      restoredSplit(PAIR, [summary('a'), summary('b', '2026-11-01T00:00:00.000Z')]),
    ).toMatchObject({ primary: 'a', secondary: null });
    expect(restoredSplit(PAIR, [summary('b')])).toMatchObject({ primary: 'b', secondary: null });
  });

  it('keeps a chat that may be on a later page of a full chat list', () => {
    const page = Array.from({ length: CHAT_LIST_PAGE }, (_, index) => summary(`chat-${index}`));
    expect(restoredSplit(PAIR, [summary('a'), ...page.slice(1)])).toBe(PAIR);
    const archived = [summary('a'), summary('b', '2026-11-01T00:00:00.000Z'), ...page.slice(2)];
    expect(restoredSplit(PAIR, archived)).toMatchObject({ primary: 'a', secondary: null });
  });
});
