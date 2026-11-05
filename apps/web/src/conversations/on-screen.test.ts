import { describe, expect, it } from 'vitest';
import { onScreenChatIds } from './on-screen.ts';

const SHOWN = {
  chatsView: true,
  outpostOpen: false,
  settingsOpen: false,
  shownIds: ['chat-a'],
};

describe('onScreenChatIds', () => {
  it('is the active chat while the chat pane shows it', () => {
    expect(onScreenChatIds(SHOWN)).toEqual(['chat-a']);
  });

  it('is both chats of a split', () => {
    expect(onScreenChatIds({ ...SHOWN, shownIds: ['chat-a', 'chat-b'] })).toEqual([
      'chat-a',
      'chat-b',
    ]);
  });

  it('is no chat while another view, an outpost or Settings covers the chat pane', () => {
    expect(onScreenChatIds({ ...SHOWN, chatsView: false })).toEqual([]);
    expect(onScreenChatIds({ ...SHOWN, outpostOpen: true })).toEqual([]);
    expect(onScreenChatIds({ ...SHOWN, settingsOpen: true })).toEqual([]);
  });
});
