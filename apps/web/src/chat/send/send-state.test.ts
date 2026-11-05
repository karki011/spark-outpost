import { describe, expect, it } from 'vitest';
import {
  SEND_SLOW_MS,
  nextSlowAt,
  pendingSends,
  type OutgoingMessage,
  type SendAttempt,
} from './send-state.ts';

const NONE = new Set<string>();

function message(id: string, content = `Message ${id}`): OutgoingMessage {
  return { id, content, attachments: [] };
}

function attempt(
  id: string,
  status: SendAttempt['status'],
  submittedAt: number,
  error: string | null = null,
): SendAttempt {
  return { message: message(id), status, error, submittedAt };
}

describe('pending sends', () => {
  it('shows a fresh send as starting and a send past the limit as slow', () => {
    const sends = pendingSends(
      [attempt('a', 'pending', 1_000), attempt('b', 'pending', 2_000)],
      NONE,
      1_000 + SEND_SLOW_MS,
    );
    expect(sends.map((send) => [send.message.id, send.phase])).toEqual([
      ['a', 'slow'],
      ['b', 'starting'],
    ]);
    expect(nextSlowAt(sends)).toBe(2_000 + SEND_SLOW_MS);
  });

  it('keeps a failed send with its error until it is retried', () => {
    const failed = pendingSends([attempt('a', 'error', 1_000, 'Server down.')], NONE, 2_000);
    expect(failed).toMatchObject([{ phase: 'failed', error: 'Server down.' }]);
    expect(nextSlowAt(failed)).toBeNull();

    const retried = pendingSends(
      [attempt('a', 'error', 1_000, 'Server down.'), attempt('a', 'pending', 3_000)],
      NONE,
      3_500,
    );
    expect(retried).toMatchObject([{ phase: 'starting', submittedAt: 3_000 }]);
  });

  it('keeps accepted messages until they appear in the chat', () => {
    const attempts = [
      attempt('a', 'pending', 1_000),
      attempt('a', 'success', 7_000),
      attempt('b', 'error', 2_000, 'Timed out.'),
    ];
    expect(
      pendingSends(attempts, NONE, 9_000).map((send) => [send.message.id, send.phase]),
    ).toEqual([
      ['a', 'accepted'],
      ['b', 'failed'],
    ]);
    expect(pendingSends(attempts, new Set(['a', 'b']), 9_000)).toEqual([]);
  });

  it('shows one entry per message even after several retries', () => {
    const sends = pendingSends(
      [attempt('a', 'pending', 1_000), attempt('a', 'pending', 6_500), attempt('b', 'idle', 0)],
      NONE,
      7_000,
    );
    expect(sends).toMatchObject([{ message: { id: 'a' }, phase: 'starting' }]);
  });
});
