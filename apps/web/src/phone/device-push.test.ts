import { describe, expect, it } from 'vitest';
import { bytesOf } from './passkey-browser.ts';
import { isPushOn } from './use-device-push.ts';
import { targetOfMessage } from './use-notification-chats.ts';

const CHAT = '0190a3b5-0000-7000-8000-000000000001';
const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

function local(endpoint: string, key: string) {
  const subscription = {
    endpoint,
    options: { applicationServerKey: bytesOf(key).buffer },
  } as unknown as PushSubscription;
  return { registration: {} as ServiceWorkerRegistration, subscription };
}

describe('isPushOn', () => {
  it('is on when the Mac holds this browser’s subscription under its current key', () => {
    const state = { publicKey: KEY, endpoints: ['https://push/a'] };
    expect(isPushOn(local('https://push/a', KEY), state)).toBe(true);
  });

  it('is off when the Mac forgot the subscription, or its key changed', () => {
    expect(isPushOn(local('https://push/a', KEY), { publicKey: KEY, endpoints: [] })).toBe(false);
    const state = { publicKey: KEY, endpoints: ['https://push/a'] };
    expect(isPushOn(local('https://push/a', 'AAAA'), state)).toBe(false);
    expect(isPushOn(undefined, state)).toBe(false);
  });
});

describe('targetOfMessage', () => {
  const CARD = '3f2b8c1e-9d4a-4b6e-8a17-5c0d2e7f9a31';

  it('opens a chat only for a well-formed message from the service worker', () => {
    expect(targetOfMessage({ type: 'spark-open-chat', chatId: CHAT })).toEqual({
      chatId: CHAT,
      cardId: null,
    });
    expect(targetOfMessage({ type: 'spark-open-chat', chatId: '../settings' })).toBeNull();
    expect(targetOfMessage({ type: 'other', chatId: CHAT })).toBeNull();
    expect(targetOfMessage('spark-open-chat')).toBeNull();
    expect(targetOfMessage(null)).toBeNull();
  });

  it('keeps a card id that is a UUID and ignores any other', () => {
    expect(targetOfMessage({ type: 'spark-open-chat', chatId: CHAT, cardId: CARD })).toEqual({
      chatId: CHAT,
      cardId: CARD,
    });
    for (const cardId of ['../x', '', 5, null, `${CARD}"><script>`]) {
      expect(targetOfMessage({ type: 'spark-open-chat', chatId: CHAT, cardId })).toEqual({
        chatId: CHAT,
        cardId: null,
      });
    }
  });
});
