import { describe, expect, it } from 'vitest';
import { PASSKEY_CHALLENGE_TTL_MS } from '@spark-outpost/contracts';
import { deviceBinding, PasskeyChallenges, ticketBinding } from './passkey-challenges.ts';

function clocked() {
  const clock = { at: 1_000_000 };
  return { clock, challenges: new PasskeyChallenges(() => clock.at) };
}

describe('passkey challenges', () => {
  it('gives each caller a fresh 32-byte challenge', () => {
    const { challenges } = clocked();
    const first = challenges.issue(ticketBinding('a'));
    const second = challenges.issue(ticketBinding('b'));
    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
  });

  it('accepts a challenge once, from the caller it was given to', () => {
    const { challenges } = clocked();
    const challenge = challenges.issue(ticketBinding('a'));
    expect(challenges.consume(challenge, ticketBinding('a'))).toBe(true);
    expect(challenges.consume(challenge, ticketBinding('a'))).toBe(false);
  });

  it('refuses another caller and burns the challenge', () => {
    const { challenges } = clocked();
    const challenge = challenges.issue(ticketBinding('a'));
    expect(challenges.consume(challenge, ticketBinding('b'))).toBe(false);
    expect(challenges.consume(challenge, ticketBinding('a'))).toBe(false);
  });

  it('keeps a device challenge apart from a sign-in ticket with the same text', () => {
    const { challenges } = clocked();
    const challenge = challenges.issue(deviceBinding('x'));
    expect(challenges.consume(challenge, ticketBinding('x'))).toBe(false);
  });

  it('refuses a challenge after two minutes', () => {
    const { clock, challenges } = clocked();
    const kept = challenges.issue(ticketBinding('a'));
    const late = challenges.issue(ticketBinding('b'));
    clock.at += PASSKEY_CHALLENGE_TTL_MS - 1;
    expect(challenges.consume(kept, ticketBinding('a'))).toBe(true);
    clock.at += 1;
    expect(challenges.consume(late, ticketBinding('b'))).toBe(false);
  });

  it('keeps one live challenge per caller', () => {
    const { challenges } = clocked();
    const first = challenges.issue(deviceBinding('x'));
    const second = challenges.issue(deviceBinding('x'));
    expect(challenges.consume(first, deviceBinding('x'))).toBe(false);
    expect(challenges.consume(second, deviceBinding('x'))).toBe(true);
  });

  it('refuses a challenge it never issued', () => {
    const { challenges } = clocked();
    expect(challenges.consume('made-up', ticketBinding('a'))).toBe(false);
  });
});
