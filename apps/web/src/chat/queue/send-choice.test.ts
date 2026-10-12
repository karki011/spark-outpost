import { describe, expect, it } from 'vitest';
import type { MemberMessage, Run } from '@spark-outpost/contracts';
import {
  busyHint,
  choiceKey,
  choiceNote,
  choiceTitle,
  enterAction,
  enterWhileBusy,
  otherAction,
  sendNowStatus,
} from './send-choice.ts';

const plain = { metaKey: false, ctrlKey: false };
const TURN = '00000000-0000-4000-8000-000000000001';
const NEXT = '00000000-0000-4000-8000-000000000002';
const NOTE = '00000000-0000-4000-8000-000000000003';
const FIRST = '00000000-0000-4000-8000-000000000004';

function run(id: string, status: Run['status'], userMessageId = FIRST) {
  return { id, status, userMessageId };
}

function note(status: MemberMessage['status'], extra: Partial<MemberMessage> = {}): MemberMessage {
  return {
    id: NOTE,
    runId: TURN,
    body: 'Use UTC.',
    urgency: 'now',
    status,
    messageId: null,
    createdAt: '2026-10-04T10:00:00Z',
    deliveredAt: null,
    ...extra,
  };
}

describe('what Enter does while a turn runs', () => {
  it('uses the preferred action on Enter and the other one with ⌘ or Ctrl', () => {
    expect(enterAction(plain, 'queue')).toBe('queue');
    expect(enterAction({ metaKey: true, ctrlKey: false }, 'queue')).toBe('now');
    expect(enterAction({ metaKey: false, ctrlKey: true }, 'queue')).toBe('now');
    expect(enterAction(plain, 'now')).toBe('now');
    expect(enterAction({ metaKey: true, ctrlKey: false }, 'now')).toBe('queue');
    expect(otherAction('now')).toBe('queue');
  });

  it('names both keys in the hint, following the setting and the platform', () => {
    expect(busyHint('queue', true)).toBe('Enter to queue · ⌘Enter to send now');
    expect(busyHint('now', true)).toBe('Enter to send now · ⌘Enter to queue');
    expect(busyHint('queue', false)).toBe('Enter to queue · Ctrl+Enter to send now');
  });

  it('makes Enter send now while the agent only waits on its sub-agents, and says so', () => {
    expect(enterWhileBusy('queue', 2)).toBe('now');
    expect(enterWhileBusy('queue', 0)).toBe('queue');
    expect(enterWhileBusy('now', 0)).toBe('now');
    expect(busyHint('now', true, 2)).toBe(
      'Enter to send to the agent now, while it waits on 2 sub-agents · ⌘Enter to queue',
    );
    expect(busyHint('now', false, 1)).toBe(
      'Enter to send to the agent now, while it waits on 1 sub-agent · Ctrl+Enter to queue',
    );
  });

  it('says what Send now does while the agent only waits', () => {
    expect(choiceNote('now', true)).toBe('Reaches the agent while it waits, or joins the queue');
    expect(choiceNote('now', false)).toBe('Steers or interrupts the turn');
    expect(choiceNote('queue', true)).toBe('Sends when this turn ends');
    expect(choiceTitle('now', 'now', true, true)).toBe(
      'Send now: reaches the agent while it waits, or joins the queue (Enter)',
    );
  });

  it('labels each choice with its key', () => {
    expect(choiceKey('queue', 'queue', true)).toBe('Enter');
    expect(choiceKey('now', 'queue', false)).toBe('Ctrl+Enter');
    expect(choiceTitle('queue', 'queue', true)).toBe('Queue: sends when this turn ends (Enter)');
    expect(choiceTitle('now', 'queue', true)).toBe(
      'Send now: steers or interrupts the turn (⌘Enter)',
    );
    expect(choiceTitle('queue', 'now', true)).toBe('Queue: sends when this turn ends (⌘Enter)');
  });
});

describe('what Send now did', () => {
  it('says nothing when no message was sent that way', () => {
    expect(sendNowStatus({ runs: [run(TURN, 'running')] })).toBeNull();
    expect(
      sendNowStatus({
        runs: [run(TURN, 'running')],
        memberMessages: [note('queued', { urgency: 'next' })],
      }),
    ).toBeNull();
    expect(
      sendNowStatus({
        runs: [run(TURN, 'running')],
        memberMessages: [note('delivered', { runId: NEXT })],
      }),
    ).toBeNull();
  });

  it('follows a steered message while its turn runs, then goes quiet', () => {
    const runs = [run(TURN, 'awaiting_approval')];
    expect(sendNowStatus({ runs, memberMessages: [note('queued')] })).toBe(
      'Sending to the running turn…',
    );
    expect(sendNowStatus({ runs, memberMessages: [note('delivered')] })).toBeNull();
    expect(
      sendNowStatus({ runs: [run(TURN, 'succeeded')], memberMessages: [note('delivered')] }),
    ).toBeNull();
  });

  it('says the turn was stopped when the agent could not steer', () => {
    expect(
      sendNowStatus({ runs: [run(TURN, 'running')], memberMessages: [note('interrupting')] }),
    ).toBe('Stopping the turn to send your message…');
    const sent = [note('sent', { messageId: NOTE })];
    expect(
      sendNowStatus({
        runs: [run(TURN, 'cancelled'), run(NEXT, 'running', NOTE)],
        memberMessages: sent,
      }),
    ).toBe('Stopped the turn to send your message');
    expect(
      sendNowStatus({
        runs: [run(TURN, 'cancelled'), run(NEXT, 'succeeded', NOTE)],
        memberMessages: sent,
      }),
    ).toBeNull();
  });

  it('says the message went next when the turn ended by itself first', () => {
    expect(
      sendNowStatus({
        runs: [run(TURN, 'succeeded'), run(NEXT, 'queued', NOTE)],
        memberMessages: [note('sent', { messageId: NOTE })],
      }),
    ).toBe('Sent as your next message');
  });
});
