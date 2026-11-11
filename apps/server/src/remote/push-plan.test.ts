import { describe, expect, it } from 'vitest';
import {
  isPushEndpoint,
  closePush,
  pushMessage,
  quietDevice,
  SentKeys,
  TerminalWaits,
} from './push-plan.ts';

const CHAT = '0190a3b5-0000-7000-8000-000000000001';

describe('isPushEndpoint', () => {
  it('accepts the browser push services', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QGuQ')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://wns2-by3p.notify.windows.com/w/?token=x')).toBe(true);
  });

  it('refuses anything else, so a device cannot make the Mac call an address it chose', () => {
    for (const endpoint of [
      'not a url',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://localhost/api/reset',
      'https://127.0.0.1:4317/api/reset',
      'https://192.168.1.10/push',
      'https://fcm.googleapis.com.evil.test/x',
      'https://evilfcm.googleapis.com/x',
      'https://push.apple.com/x',
      'https://a.b.push.apple.com/x',
      'https://me:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});

describe('pushMessage', () => {
  it('names the chat and the kind of card only', () => {
    expect(
      pushMessage({ conversationId: CHAT, title: 'Fix the upload retry' }, [
        { key: 'approval:1', source: 'approval:1', kind: 'approval', detail: 'execute' },
        { key: 'approval:2', source: 'approval:2', kind: 'approval', detail: 'execute' },
        { key: 'approval:3', source: 'approval:3', kind: 'approval', detail: 'accept' },
      ]),
    ).toEqual({
      title: 'Fix the upload retry',
      body: 'Needs your approval (2) · Has changes for you to review',
      chatId: CHAT,
      tag: `spark-chat-${CHAT}`,
      keys: ['approval:1', 'approval:2', 'approval:3'],
    });
  });

  it('closes a chat’s notification by its tag, carrying the keys it showed', () => {
    expect(closePush(CHAT, ['approval:1'])).toEqual({
      close: `spark-chat-${CHAT}`,
      keys: ['approval:1'],
    });
  });

  it('says a Terminal session is waiting', () => {
    const message = pushMessage({ conversationId: CHAT, title: 'Build' }, [
      { key: 't', source: 't', kind: 'terminal', detail: 'waiting_for_input' },
    ]);
    expect(message.body).toBe('Waiting for input in the terminal');
  });

  it('removes secrets from the title and shortens it', () => {
    const message = pushMessage(
      { conversationId: CHAT, title: `Use ghp_${'a'.repeat(36)} ${'long '.repeat(40)}` },
      [{ key: 'a', source: 'a', kind: 'approval', detail: 'clarify' }],
    );
    expect(message.title).not.toContain('ghp_aaaa');
    expect(message.title.length).toBeLessThanOrEqual(80);
  });

  it('names an untitled chat', () => {
    const message = pushMessage({ conversationId: CHAT, title: '  ' }, [
      { key: 'a', source: 'a', kind: 'approval', detail: 'plan' },
    ]);
    expect(message).toMatchObject({
      title: 'Untitled chat',
      body: 'Has a plan for you to review',
    });
  });
});

describe('quietDevice', () => {
  it('is quiet only for the device that is in focus', () => {
    expect(quietDevice('a', ['device:a', 'local:window'])).toBe(true);
    expect(quietDevice('b', ['device:a', 'local:window'])).toBe(false);
  });
});

describe('SentKeys', () => {
  it('claims a key once', () => {
    const keys = new SentKeys();
    expect(keys.claim('approval:1')).toBe(true);
    expect(keys.claim('approval:1')).toBe(false);
    expect(keys.claim('approval:2')).toBe(true);
  });
});

describe('TerminalWaits', () => {
  it('gives each wait its own key and keeps it while the session waits', () => {
    const waits = new TerminalWaits();
    expect(waits.key('s', 1, 'working')).toBeNull();
    const first = waits.key('s', 1, 'waiting_for_permission');
    expect(waits.key('s', 1, 'waiting_for_permission')).toBe(first);
    expect(waits.key('s', 1, 'waiting_for_input')).toBe(first);
    expect(waits.key('s', 1, 'working')).toBeNull();
    const second = waits.key('s', 1, 'waiting_for_input');
    expect(second).not.toBe(first);
    expect(waits.key('s', 2, 'waiting_for_input')).not.toBe(second);
  });
});

describe('pushMessage for finished turns and card ids', () => {
  const CARD = '3f2b8c1e-9d4a-4b6e-8a17-5c0d2e7f9a31';
  const finished = {
    key: 'run-done:r1',
    source: 'run-done:r1',
    kind: 'run-done' as const,
    detail: null,
  };
  const card = { key: `approval:${CARD}`, source: `approval:${CARD}`, kind: 'approval' as const };
  const chat = { conversationId: CHAT, title: 'Build' };

  it('says only Finished or Failed, whatever the detail holds', () => {
    const failed = {
      key: 'run-failed:r2',
      source: 'run-failed:r2',
      kind: 'run-failed' as const,
      detail: 'ENOENT /Users/me/secret',
    };
    expect(pushMessage(chat, [finished]).body).toBe('Finished');
    const message = pushMessage(chat, [failed]);
    expect(message.body).toBe('Failed');
    expect(JSON.stringify(message)).not.toContain('secret');
  });

  it('limits the title the same way for every kind', () => {
    const long = 'x'.repeat(200);
    expect(pushMessage({ conversationId: CHAT, title: long }, [finished]).title).toHaveLength(80);
    expect(pushMessage({ conversationId: CHAT, title: '  ' }, [finished]).title).toBe(
      'Untitled chat',
    );
  });

  it('carries the card id only for a push about exactly one card', () => {
    const one = pushMessage(chat, [{ ...card, detail: 'execute', cardId: CARD }]);
    expect(one.cardId).toBe(CARD);
    const two = pushMessage(chat, [
      { ...card, detail: 'execute', cardId: CARD },
      { ...card, key: 'approval:b', source: 'approval:b', detail: 'execute', cardId: 'b' },
    ]);
    expect(two).not.toHaveProperty('cardId');
    const mixed = pushMessage(chat, [{ ...card, detail: 'execute', cardId: CARD }, finished]);
    expect(mixed).not.toHaveProperty('cardId');
    expect(pushMessage(chat, [finished])).not.toHaveProperty('cardId');
  });
});
