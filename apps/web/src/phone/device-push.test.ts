import { describe, expect, it } from 'vitest';
import { bytesOf } from './passkey-browser.ts';
import { isPushOn } from './use-device-push.ts';
import { chatOfMessage } from './use-notification-chats.ts';

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

describe('chatOfMessage', () => {
  it('opens a chat only for a well-formed message from the service worker', () => {
    expect(chatOfMessage({ type: 'spark-open-chat', chatId: CHAT })).toBe(CHAT);
    expect(chatOfMessage({ type: 'spark-open-chat', chatId: '../settings' })).toBeNull();
    expect(chatOfMessage({ type: 'other', chatId: CHAT })).toBeNull();
    expect(chatOfMessage('spark-open-chat')).toBeNull();
    expect(chatOfMessage(null)).toBeNull();
  });
});
