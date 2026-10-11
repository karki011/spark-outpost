import { describe, expect, it } from 'vitest';
import type { Message } from '@spark-outpost/contracts';
import { copiedReply, splitAtPublish, turnReplies } from './turn-replies.ts';

const later = [{ content: 'Pushed.' }, { content: 'Opened pull request #4.' }] as Message[];
const stream = { text: 'Changed the par', publishText: '' };

describe('the replies a turn shows', () => {
  it('shows the stored work reply and the stored publish replies of a finished run', () => {
    expect(turnReplies(stream, { reply: 'Changed the parser.', later }, false)).toEqual({
      text: 'Changed the parser.',
      publishText: 'Pushed.\n\nOpened pull request #4.',
    });
  });

  it('shows the stream while it leads, so a stored first reply never hides the second', () => {
    const live = { text: 'Changed the parser.', publishText: 'Pushing' };
    expect(turnReplies(live, { reply: 'Changed the parser.', later: [] }, true)).toEqual(live);
  });

  it('shows the stream when nothing is stored yet', () => {
    expect(turnReplies(stream, { reply: undefined, later: [] }, false)).toEqual(stream);
  });

  it('copies both parts as one reply and the work reply alone when nothing was published', () => {
    expect(copiedReply({ text: 'Changed.', publishText: 'Pushed.' })).toBe('Changed.\n\nPushed.');
    expect(copiedReply({ text: 'Changed.', publishText: '' })).toBe('Changed.');
  });
});

describe('the commands of a turn with a publish step', () => {
  const test = { id: 'test', startedAt: '2026-10-10T10:00:01.000Z' };
  const push = { id: 'push', startedAt: '2026-10-10T10:00:09.000Z' };

  it('puts a command started after the work reply closed with the publish result', () => {
    const start = {
      streamed: [],
      streamedBeforePublish: null,
      replyClosedAt: '2026-10-10T10:00:05.000Z',
    };
    expect(splitAtPublish([test, push], start)).toEqual({ reply: [test], publish: [push] });
  });

  it('splits a live turn by what had started when the work reply closed', () => {
    const start = { streamed: [test, push], streamedBeforePublish: 1, replyClosedAt: null };
    expect(splitAtPublish([test, push], start)).toEqual({ reply: [test], publish: [push] });
  });

  it('keeps every command with the reply when the run has one reply', () => {
    const start = { streamed: [test, push], streamedBeforePublish: null, replyClosedAt: null };
    expect(splitAtPublish([test, push], start)).toEqual({ reply: [test, push], publish: [] });
  });
});
