import { describe, expect, it } from 'vitest';
import { PAIRING_TTL_MS } from '@spark-outpost/contracts';
import { PairingRateLimitError, Pairings } from './pairing.ts';

function clocked() {
  const clock = { at: 1_000_000 };
  return { clock, pairings: new Pairings(() => clock.at) };
}

describe('pairing', () => {
  it('pairs after the code is typed and the Mac confirms', () => {
    const { pairings } = clocked();
    const started = pairings.start();
    const submitted = pairings.submit(started.code.toLowerCase(), 'Phone')!;

    expect(pairings.pending()).toEqual([
      expect.objectContaining({
        id: started.id,
        deviceName: 'Phone',
        matchCode: submitted.matchCode,
      }),
    ]);
    expect(submitted.matchCode).toMatch(/^\d{3} \d{3}$/);
    expect(pairings.claim(submitted.claim)).toEqual({ status: 'waiting' });

    pairings.confirm(started.id);
    expect(pairings.pending()).toEqual([]);
    expect(pairings.claim(submitted.claim)).toEqual({
      status: 'confirmed',
      id: started.id,
      deviceName: 'Phone',
    });
    expect(pairings.claim(submitted.claim)).toBeNull();
  });

  it('refuses a wrong code and a code used twice', () => {
    const { pairings } = clocked();
    const started = pairings.start();
    expect(pairings.submit('AAAA-AAAA-AAAA', 'Phone')).toBeNull();
    expect(pairings.submit(started.code, 'Phone')).not.toBeNull();
    expect(pairings.submit(started.code, 'Other phone')).toBeNull();
  });

  it('refuses a code after two minutes', () => {
    const { clock, pairings } = clocked();
    const started = pairings.start();
    clock.at += PAIRING_TTL_MS;
    expect(pairings.submit(started.code, 'Phone')).toBeNull();
  });

  it('drops a typed code the Mac never confirmed', () => {
    const { clock, pairings } = clocked();
    const started = pairings.start();
    const submitted = pairings.submit(started.code, 'Phone')!;
    clock.at += PAIRING_TTL_MS;
    expect(pairings.pending()).toEqual([]);
    expect(pairings.confirm(started.id)).toBeNull();
    expect(pairings.claim(submitted.claim)).toBeNull();
  });

  it('drops a confirmed pairing the phone never collected', () => {
    const { clock, pairings } = clocked();
    const started = pairings.start();
    const submitted = pairings.submit(started.code, 'Phone')!;
    pairings.confirm(started.id);
    clock.at += PAIRING_TTL_MS;
    expect(pairings.claim(submitted.claim)).toBeNull();
  });

  it('ends a denied pairing and cannot confirm it afterwards', () => {
    const { pairings } = clocked();
    const started = pairings.start();
    const submitted = pairings.submit(started.code, 'Phone')!;
    expect(pairings.deny(started.id)).toMatchObject({ deviceName: 'Phone' });
    expect(pairings.claim(submitted.claim)).toBeNull();
    expect(pairings.confirm(started.id)).toBeNull();
  });

  it('cannot confirm a code nobody typed', () => {
    const { pairings } = clocked();
    expect(pairings.confirm(pairings.start().id)).toBeNull();
  });

  it('keeps one live code: a new one replaces the last', () => {
    const { pairings } = clocked();
    const first = pairings.start();
    const second = pairings.start();
    expect(pairings.submit(first.code, 'Phone')).toBeNull();
    expect(pairings.submit(second.code, 'Phone')).not.toBeNull();
  });

  it('limits guesses and new codes per minute', () => {
    const { clock, pairings } = clocked();
    const started = pairings.start();
    for (let guess = 0; guess < 5; guess += 1) pairings.submit('WRONG', 'Phone');
    expect(() => pairings.submit(started.code, 'Phone')).toThrow(PairingRateLimitError);

    for (let again = 0; again < 4; again += 1) pairings.start();
    expect(() => pairings.start()).toThrow(PairingRateLimitError);

    clock.at += 60_001;
    const fresh = pairings.start();
    expect(pairings.submit(fresh.code, 'Phone')).not.toBeNull();
  });

  it('takes a different limit for both windows when one is given', () => {
    const pairings = new Pairings(() => 1_000_000, 8);
    for (let again = 0; again < 7; again += 1) pairings.start();
    const last = pairings.start();
    expect(() => pairings.start()).toThrow(PairingRateLimitError);
    for (let guess = 0; guess < 7; guess += 1) pairings.submit('WRONG', 'Phone');
    expect(pairings.submit(last.code, 'Phone')).not.toBeNull();
    expect(() => pairings.submit(last.code, 'Phone')).toThrow(PairingRateLimitError);
  });

  it('issues codes of twelve unambiguous characters', () => {
    const { pairings } = clocked();
    expect(pairings.start().code).toMatch(
      /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/,
    );
  });
});
