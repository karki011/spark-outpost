import { describe, expect, it } from 'vitest';
import { onScreenChatId } from './on-screen.ts';

const SHOWN = { chatsView: true, outpostOpen: false, settingsOpen: false, activeId: 'chat-a' };

describe('onScreenChatId', () => {
  it('is the active chat while the chat pane shows it', () => {
    expect(onScreenChatId(SHOWN)).toBe('chat-a');
  });

  it('is no chat while another view, an outpost or Settings covers the chat pane', () => {
    expect(onScreenChatId({ ...SHOWN, chatsView: false })).toBeNull();
    expect(onScreenChatId({ ...SHOWN, outpostOpen: true })).toBeNull();
    expect(onScreenChatId({ ...SHOWN, settingsOpen: true })).toBeNull();
  });
});
