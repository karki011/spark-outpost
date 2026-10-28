import { describe, expect, it } from 'vitest';
import type { ProviderMessage, SteerRequests } from '../../providers/provider.ts';
import { createIdleInbox, deliveringWhenIdle } from './idle-inbox.ts';

function listener() {
  let send: ((text: ProviderMessage) => Promise<boolean>) | null = null;
  const steering: SteerRequests = {
    attach(sender) {
      send = sender;
      return () => {
        send = null;
      };
    },
  };
  return { steering, current: () => send };
}

describe('the idle inbox', () => {
  it('listens for messages only while the agent waits on background work', async () => {
    const { steering, current } = listener();
    const inbox = createIdleInbox(steering);
    expect(current()).toBeNull();

    inbox.open();
    expect(await current()?.('Any news?')).toBe(true);
    expect(inbox.take()).toBe('Any news?');

    inbox.close();
    expect(current()).toBeNull();
  });

  it('takes a message for the session while waiting and steers it otherwise', async () => {
    const { steering, current } = listener();
    const inbox = createIdleInbox();
    const steered: ProviderMessage[] = [];
    deliveringWhenIdle(steering, inbox)?.attach(async (text) => {
      steered.push(text);
      return true;
    });

    await current()?.('during the turn');
    inbox.open();
    await current()?.('during the wait');

    expect(steered).toEqual(['during the turn']);
    expect(inbox.take()).toBe('during the wait');
  });
});
