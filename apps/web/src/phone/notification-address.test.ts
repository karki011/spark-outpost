// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { takeChatParam } from './use-notification-chats.ts';

const CHAT = '0190a3b5-0000-7000-8000-000000000001';

describe('takeChatParam', () => {
  const CARD = '3f2b8c1e-9d4a-4b6e-8a17-5c0d2e7f9a31';

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('reads the chat and card from the address and removes both', () => {
    window.history.replaceState(null, '', `/?chat=${CHAT}&card=${CARD}&x=1`);
    expect(takeChatParam()).toEqual({ chatId: CHAT, cardId: CARD });
    expect(window.location.search).toBe('?x=1');
  });

  it('ignores a bad card id and drops a card with no valid chat', () => {
    window.history.replaceState(null, '', `/?chat=${CHAT}&card=nope`);
    expect(takeChatParam()).toEqual({ chatId: CHAT, cardId: null });
    window.history.replaceState(null, '', `/?chat=bad&card=${CARD}`);
    expect(takeChatParam()).toBeNull();
    expect(window.location.search).toBe('');
  });
});
