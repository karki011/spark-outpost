import { describe, expect, it } from 'vitest';
import { API_CHAT, FE_CHAT, chat } from '../outposts/test-fixtures.ts';
import { seenNotification } from './close-seen-notifications.ts';

const WAITING = '2026-10-09T10:05:00.000Z';
const waiting = (seenAt: string | null) =>
  chat(FE_CHAT, { needsInput: true, waitingSince: WAITING, seenAt });

describe('seenNotification', () => {
  it('closes the notification of the chat open on this device', () => {
    expect(seenNotification(`spark-chat-${FE_CHAT}`, [waiting(null)], FE_CHAT)).toBe(true);
  });

  it('keeps it while the request has not been seen anywhere', () => {
    expect(seenNotification(`spark-chat-${FE_CHAT}`, [waiting(null)], API_CHAT)).toBe(false);
  });

  it('closes it on the next sync once the chat was seen on the Mac or answered', () => {
    const seen = waiting('2026-10-09T10:06:00.000Z');
    expect(seenNotification(`spark-chat-${FE_CHAT}`, [seen], null)).toBe(true);
    expect(seenNotification(`spark-chat-${FE_CHAT}`, [chat(FE_CHAT)], null)).toBe(true);
  });

  it('leaves meeting and unknown notifications alone', () => {
    expect(seenNotification('spark-meeting', [waiting(null)], FE_CHAT)).toBe(false);
    expect(seenNotification(`spark-chat-${API_CHAT}`, [waiting(null)], null)).toBe(false);
  });
});
