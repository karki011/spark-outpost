import { describe, expect, it } from 'vitest';
import type { MemberMessage } from '@spark-outpost/contracts';
import { canContinue, memberIsLive, messageState, messageTone } from './member-model.ts';

function message(status: MemberMessage['status']): MemberMessage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    runId: '00000000-0000-4000-8000-000000000002',
    body: 'Use UTC',
    urgency: 'next',
    status,
    messageId: null,
    createdAt: '2026-10-02T10:00:00Z',
    deliveredAt: null,
  };
}

describe('member messages', () => {
  it('treats working, waiting and queued members as live', () => {
    expect(memberIsLive({ state: 'working' })).toBe(true);
    expect(memberIsLive({ state: 'waiting' })).toBe(true);
    expect(memberIsLive({ state: 'queued' })).toBe(true);
    expect(memberIsLive({ state: 'done' })).toBe(false);
  });

  it('only continues members that change code', () => {
    expect(canContinue({ role: 'builder' })).toBe(true);
    expect(canContinue({ role: 'integrator' })).toBe(true);
    expect(canContinue({ role: 'critic' })).toBe(false);
    expect(canContinue({ role: 'scout' })).toBe(false);
  });

  it('describes each delivery state in plain words', () => {
    expect(messageState(message('queued'), true, 'Bolt')).toBe('Bolt reads this at its next step');
    expect(messageState(message('queued'), false, 'Bolt')).toBe(
      'Bolt finished before reading this',
    );
    expect(messageState(message('delivered'), false, 'Bolt')).toBe('Bolt has it');
    expect(messageState(message('continued'), false, 'Bolt')).toBe(
      'Bolt picked this up in a new turn',
    );
    expect(messageTone(message('queued'), true)).toBe('wait');
    expect(messageTone(message('queued'), false)).toBe('miss');
    expect(messageTone(message('missed'), false)).toBe('miss');
    expect(messageTone(message('delivered'), true)).toBe('ok');
  });
});
