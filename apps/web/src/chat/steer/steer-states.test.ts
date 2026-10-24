import { describe, expect, it } from 'vitest';
import type { ConversationDetail, MemberMessage, Run } from '@spark-outpost/contracts';
import type { TurnRowPart } from '../rows/turn-rows.ts';
import { canResend, seenAfter, steerGroups, steerMarks, steerStatus } from './steer-model.ts';

const TOP = 'top';
const DELIVERED_AT = '2026-10-05T10:01:00.000Z';

const run = (status: Run['status']) =>
  ({ id: TOP, status, parentRunId: null, provider: 'claude' }) as Run;

const steer = (id: string, extra: Partial<MemberMessage> = {}): MemberMessage => ({
  id,
  runId: TOP,
  body: `body ${id}`,
  urgency: 'now',
  status: 'queued',
  messageId: null,
  createdAt: '2026-10-05T10:00:30.000Z',
  deliveredAt: null,
  ...extra,
});

const delivered = (id: string, extra: Partial<MemberMessage> = {}) =>
  steer(id, { status: 'delivered', deliveredAt: DELIVERED_AT, ...extra });

const detail = (status: Run['status']) =>
  ({ runs: [run(status)], messages: [], memberMessages: [] }) as unknown as ConversationDetail;

const NOT_SEEN = { taken: false, answered: false };
const TAKEN = { taken: true, answered: false };
const ANSWERED = { taken: true, answered: true };

describe('a message sent to a running solo turn', () => {
  const live = detail('running');
  const running = run('running');

  it('says it was sent until the agent takes a step after it arrived', () => {
    expect(steerStatus(steer('a'), live, running, false, NOT_SEEN)).toEqual({
      text: 'Sent · Claude reads it at its next step',
      tone: 'wait',
    });
    expect(steerStatus(delivered('a'), live, running, false, NOT_SEEN)).toEqual({
      text: 'Sent · Claude reads it at its next step',
      tone: 'wait',
    });
  });

  it('says the agent took it in, with the time it arrived, once anything follows it', () => {
    expect(steerStatus(delivered('a'), live, running, false, TAKEN)).toEqual({
      text: 'Claude took this in',
      tone: 'ok',
      at: DELIVERED_AT,
    });
  });
});

describe('a message sent to a turn the user stopped', () => {
  const stopped = detail('cancelled');
  const cancelled = run('cancelled');

  it('says the turn stopped before the agent read it, and offers to send it again', () => {
    const missed = steer('a', { status: 'missed' });
    expect(steerStatus(missed, stopped, cancelled, false, NOT_SEEN)).toEqual({
      text: 'Stopped before Claude read this',
      tone: 'miss',
    });
    expect(canResend(missed)).toBe(true);
  });

  it('says the turn stopped before an answer when the agent took it in and wrote nothing after', () => {
    expect(steerStatus(delivered('a'), stopped, cancelled, false, TAKEN)).toEqual({
      text: 'Stopped before Claude answered this',
      tone: 'stopped',
    });
    expect(steerStatus(delivered('a'), stopped, cancelled, false, ANSWERED).text).toBe(
      'Claude took this in',
    );
  });

  it('never offers to resend a message that was taken in or already became a message', () => {
    expect(canResend(delivered('a'))).toBe(false);
    expect(canResend(steer('a', { status: 'missed', messageId: 'a' }))).toBe(false);
  });
});

describe('a finished turn', () => {
  it('keeps a message the agent took in as taken in, even with nothing after it', () => {
    const done = detail('succeeded');
    expect(steerStatus(delivered('a'), done, run('succeeded'), false, NOT_SEEN).text).toBe(
      'Claude took this in',
    );
  });
});

describe('steerGroups', () => {
  it('gives messages taken in together one status line', () => {
    const groups = steerGroups(
      [delivered('a'), delivered('b'), delivered('c')],
      detail('running'),
      run('running'),
      false,
      TAKEN,
    );
    expect(groups.map((group) => group.messages.map((message) => message.id))).toEqual([
      ['a', 'b', 'c'],
    ]);
  });

  it('keeps messages taken in moments apart together, with the latest time', () => {
    const later = '2026-10-05T10:01:20.000Z';
    const groups = steerGroups(
      [delivered('a'), delivered('b', { deliveredAt: later }), steer('c')],
      detail('running'),
      run('running'),
      false,
      TAKEN,
    );
    expect(groups.map((group) => group.messages.length)).toEqual([2, 1]);
    expect(groups[0]?.status.at).toBe(later);
  });
});

describe('steerMarks', () => {
  it('anchors a delivered message where the reply stood, and an unread one at the end', () => {
    const [anchored, unread] = steerMarks([
      delivered('a', { textOffset: 12, textBefore: 'Looking now.', textHeld: 0 }),
      steer('b'),
    ]);
    expect(anchored).toEqual({
      id: 'a',
      anchor: { textOffset: 12, textBefore: 'Looking now.', textHeld: 0 },
      time: Date.parse(DELIVERED_AT),
    });
    expect(unread?.anchor).toBeNull();
    expect(unread?.time).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('seenAfter', () => {
  const steers: TurnRowPart = { kind: 'steers', key: 's', ids: ['a'] };
  const rows: TurnRowPart = { kind: 'rows', key: 'r', rows: [] };
  const text: TurnRowPart = { kind: 'text', key: 't', text: 'On it.' };

  it('counts steps and text after the message, not other messages', () => {
    expect(seenAfter([steers], 0)).toEqual(NOT_SEEN);
    expect(seenAfter([steers, { ...steers, key: 's2' }], 0)).toEqual(NOT_SEEN);
    expect(seenAfter([steers, rows], 0)).toEqual(TAKEN);
    expect(seenAfter([steers, rows, text], 0)).toEqual(ANSWERED);
  });
});
