import { EventType, type RunEvent } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { createReplyText } from './reply-text.ts';

function recorded() {
  const events: RunEvent[] = [];
  const reply = createReplyText(async (event) => {
    events.push(event);
    return events.length;
  });
  return { events, reply };
}

describe('the text of a turn', () => {
  it('opens one message and streams every piece into it', async () => {
    const { events, reply } = recorded();

    await reply.say('Hello');
    await reply.say('');
    await reply.say(' there');

    expect(events.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
    ]);
    expect(reply.result().text).toBe('Hello there');
    expect(reply.result().messageId).not.toBeNull();
  });

  it('has no message and no final reply when nothing was said', () => {
    const { reply } = recorded();

    expect(reply.result()).toEqual({ text: '', messageId: null, finalReply: null });
  });
});

describe('the final reply of a turn', () => {
  it('is the final message, without the commentary before it', async () => {
    const { reply } = recorded();

    reply.mark('commentary', 0);
    await reply.say('I will count the tracked and untracked files.');
    reply.mark('commentary', 0);
    await reply.say('\n\nCounting now.');
    reply.mark('final', 0);
    await reply.say('\n\n3');
    reply.mark('final', 0);
    await reply.say(' files');

    expect(reply.result().text).toBe(
      'I will count the tracked and untracked files.\n\nCounting now.\n\n3 files',
    );
    expect(reply.result().finalReply).toBe('3 files');
  });

  it('is unknown when the agent never marks a final message', async () => {
    const { reply } = recorded();

    reply.mark(undefined, 0);
    await reply.say('I looked and it is 3.');
    reply.mark('commentary', 0);
    await reply.say('\n\nStill 3.');

    expect(reply.result().finalReply).toBeNull();
  });

  it('follows the latest final message when a turn has more than one', async () => {
    const { reply } = recorded();

    reply.mark('final', 0);
    await reply.say('First answer.');
    reply.mark('commentary', 0);
    await reply.say('\n\nChecking again.');
    reply.mark('final', 0);
    await reply.say('\n\nSecond answer.');

    expect(reply.result().finalReply).toBe('Second answer.');
  });

  it('starts after text that is still held back when the final message begins', async () => {
    const { reply } = recorded();

    reply.mark('commentary', 0);
    await reply.say('Looking');
    reply.mark('final', 5);
    await reply.say(' now.\n\nDone.');

    expect(reply.result().finalReply).toBe('Done.');
  });

  it('is unknown when the final message is empty', async () => {
    const { reply } = recorded();

    await reply.say('Looking.');
    reply.mark('final', 0);

    expect(reply.result().finalReply).toBeNull();
  });
});
