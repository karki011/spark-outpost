import { describe, expect, it } from 'vitest';
import type {
  ConversationDetail,
  CrewMember,
  MemberMessage,
  Message,
  Run,
} from '@spark-outpost/contracts';
import { steerSlots, steerStatus, turnSteers, withSteer } from './steer-model.ts';

const TOP = 'top';
const BOLT = 'bolt';

const run = (id: string, status: Run['status'], parentRunId: string | null = null) =>
  ({ id, status, parentRunId, provider: 'claude', userMessageId: `ask-${id}` }) as Run;

const member = (runId: string, name: string, status: CrewMember['status']) =>
  ({ runId, name, status, role: 'builder', provider: 'codex' }) as CrewMember;

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

interface Facts {
  runs?: Run[];
  crew?: CrewMember[];
  memberMessages?: MemberMessage[];
  messages?: Message[];
}

function detail(facts: Facts = {}): ConversationDetail {
  const crew = facts.crew ?? [member(TOP, 'Atlas', 'running'), member(BOLT, 'Bolt', 'running')];
  return {
    runs: facts.runs ?? [run(TOP, 'running'), run(BOLT, 'running', TOP)],
    messages: facts.messages ?? [],
    orchestrations: { [TOP]: { runId: TOP, crew } },
    memberMessages: facts.memberMessages ?? [],
  } as unknown as ConversationDetail;
}

const top = run(TOP, 'running');

describe('turnSteers', () => {
  it('lists what you sent to any member of the turn, whoever it was addressed to', () => {
    const shown = turnSteers(
      detail({
        memberMessages: [
          steer('to-turn'),
          steer('to-bolt', { runId: BOLT, urgency: 'next' }),
          steer('elsewhere', { runId: 'other-turn' }),
        ],
      }),
      TOP,
    );
    expect(shown.map((message) => message.id)).toEqual(['to-turn', 'to-bolt']);
  });

  it('keeps delivered, stopping and missed messages in the turn', () => {
    const statuses: MemberMessage['status'][] = ['queued', 'delivered', 'interrupting', 'missed'];
    const memberMessages = statuses.map((status) => steer(status, { status }));
    expect(turnSteers(detail({ memberMessages }), TOP)).toHaveLength(4);
  });

  it('drops a message once it became the next user message or continued in a new turn', () => {
    const memberMessages = [
      steer('sent', { status: 'sent', messageId: 'sent' }),
      steer('continued', { status: 'continued', messageId: 'continued', runId: BOLT }),
    ];
    expect(turnSteers(detail({ memberMessages }), TOP)).toEqual([]);
  });

  it('drops a message that is already a saved user message, even before its status says so', () => {
    const saved = { id: 'raced', role: 'user', content: 'body raced' } as Message;
    const memberMessages = [steer('raced')];
    expect(turnSteers(detail({ memberMessages, messages: [saved] }), TOP)).toEqual([]);
  });
});

describe('steerSlots', () => {
  const started = ['2026-10-05T10:00:00.000Z', '2026-10-05T10:00:10.000Z', null];

  it('puts a message after the last block that had started when it was sent', () => {
    const slots = steerSlots(started, [steer('a')]);
    expect([...slots.keys()]).toEqual([1]);
  });

  it('leaves blocks that start later below the message', () => {
    const later = [...started.slice(0, 2), '2026-10-05T10:01:00.000Z'];
    expect([...steerSlots(later, [steer('a')]).keys()]).toEqual([1]);
  });

  it('keeps messages sent to the same place in the order they were sent', () => {
    const slots = steerSlots(started, [
      steer('first'),
      steer('second', { createdAt: '2026-10-05T10:00:40.000Z' }),
    ]);
    expect(slots.get(1)?.map((message) => message.id)).toEqual(['first', 'second']);
  });

  it('puts a message sent before any block started ahead of them all', () => {
    const early = steer('early', { createdAt: '2026-10-05T09:59:00.000Z' });
    expect([...steerSlots(started, [early]).keys()]).toEqual([-1]);
    expect([...steerSlots([], [early]).keys()]).toEqual([-1]);
  });

  it('compares instants, not text, so a different timestamp format still lands in order', () => {
    const offset = steer('offset', { createdAt: '2026-10-05T06:00:05-04:00' });
    expect([...steerSlots(started, [offset]).keys()]).toEqual([0]);
  });
});

describe('steerStatus', () => {
  it('names the one member still working while a message to the turn waits', () => {
    const handedOff = detail({
      crew: [member(TOP, 'Atlas', 'running'), member(BOLT, 'Bolt', 'running')],
    });
    expect(steerStatus(steer('a'), handedOff, top, true)).toEqual({
      text: 'Sent · Bolt reads it at its next step',
      tone: 'wait',
    });
  });

  it('does not guess a reader when several members are working', () => {
    const several = detail({
      crew: [
        member(TOP, 'Atlas', 'running'),
        member(BOLT, 'Bolt', 'running'),
        member('rivet', 'Rivet', 'running'),
      ],
    });
    expect(steerStatus(steer('a'), several, top, true).text).toBe(
      'Sent · The crew reads it at its next step',
    );
  });

  it('names the member that took the message, not the run it was addressed to', () => {
    const taken = steer('a', { status: 'delivered', deliveredRunId: BOLT });
    expect(steerStatus(taken, detail(), top, true)).toEqual({
      text: 'Bolt took this in',
      tone: 'ok',
    });
  });

  it('says the turn is stopping when the agent could not take it mid-turn', () => {
    const stopping = steer('a', { status: 'interrupting' });
    expect(steerStatus(stopping, detail(), top, true)).toEqual({
      text: 'Stopping the turn to send this first',
      tone: 'wait',
    });
  });

  it('reads whether a member still works from the crew, which lists runs the chat does not', () => {
    const listedInCrewOnly = detail({ runs: [run(TOP, 'running')] });
    const waiting = steer('a', { runId: BOLT, urgency: 'next' });
    expect(steerStatus(waiting, listedInCrewOnly, top, true)).toEqual({
      text: 'Sent · Bolt reads it at its next step',
      tone: 'wait',
    });
  });

  it('marks a message the member never read as missed', () => {
    const finished = detail({
      runs: [run(TOP, 'running')],
      crew: [member(TOP, 'Atlas', 'running'), member(BOLT, 'Bolt', 'succeeded')],
    });
    const missed = steer('a', { runId: BOLT, urgency: 'next', status: 'missed' });
    const unread = steer('b', { runId: BOLT, urgency: 'next' });
    const expected = { text: 'Bolt finished before reading this', tone: 'miss' };
    expect(steerStatus(missed, finished, top, true)).toEqual(expected);
    expect(steerStatus(unread, finished, top, true)).toEqual(expected);
  });

  it('says a send-now message goes next once its turn has ended, instead of calling it missed', () => {
    const ended = detail({
      runs: [run(TOP, 'cancelled')],
      crew: [member(TOP, 'Atlas', 'cancelled'), member(BOLT, 'Bolt', 'cancelled')],
    });
    expect(steerStatus(steer('a'), ended, run(TOP, 'cancelled'), true)).toEqual({
      text: 'Sending this as your next message',
      tone: 'wait',
    });
  });

  it('names the provider in a turn with one agent', () => {
    const solo = detail({ runs: [run(TOP, 'running')], crew: [] });
    expect(steerStatus(steer('a'), solo, top, false).text).toBe(
      'Sent · Claude reads it at its next step',
    );
    const child = detail({ crew: [member(BOLT, 'Bolt', 'running')] });
    const taken = steer('a', { status: 'delivered', deliveredRunId: BOLT });
    expect(steerStatus(taken, child, top, false).text).toBe('Codex took this in');
  });
});

describe('withSteer', () => {
  const now = '2026-10-05T10:02:00.000Z';

  it('adds the message to the running turn right away, waiting to be read', () => {
    const next = withSteer(detail(), 'new', 'Use UTC', now);
    expect(next.memberMessages).toEqual([
      steer('new', { body: 'Use UTC', createdAt: now, runId: TOP }),
    ]);
    expect(turnSteers(next, TOP)).toHaveLength(1);
  });

  it('keeps image-only steers visible while their delivery is pending', () => {
    const next = withSteer(detail(), 'image', '', now, ['file-a']);
    expect(turnSteers(next, TOP)).toMatchObject([
      { id: 'image', body: '', attachmentIds: ['file-a'] },
    ]);
  });

  it('adds nothing when no turn is running or the message is already there', () => {
    const idle = detail({ runs: [run(TOP, 'succeeded')] });
    expect(withSteer(idle, 'new', 'Use UTC', now)).toBe(idle);
    const known = detail({ memberMessages: [steer('new')] });
    expect(withSteer(known, 'new', 'Use UTC', now)).toBe(known);
  });
});
