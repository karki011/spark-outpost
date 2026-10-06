import { describe, expect, it } from 'vitest';
import type { PairingStart, PendingPairing } from '@spark-outpost/contracts';
import { countdownText, pairStage, stageLine, stageMood, type PairFlowInput } from './pair-flow.ts';

const NOW = Date.parse('2026-10-06T10:00:00Z');
const started: PairingStart = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'ABCD-EFGH-JKLM',
  expiresAt: new Date(NOW + 120_000).toISOString(),
};
const request: PendingPairing = {
  id: started.id,
  deviceName: 'Kitchen phone',
  matchCode: '482 913',
  expiresAt: started.expiresAt,
};

function stageOf(change: Partial<PairFlowInput>) {
  return pairStage({
    status: 'on',
    started: null,
    pending: [],
    paired: null,
    ended: null,
    now: NOW,
    ...change,
  });
}

describe('pairing stage', () => {
  it('waits for setup until phone access is on', () => {
    for (const status of ['not_installed', 'signed_out', 'https_off', 'off', 'error'] as const) {
      expect(stageOf({ status, started }).kind).toBe('setup');
    }
    expect(stageOf({ status: undefined }).kind).toBe('setup');
  });

  it('is ready, then shows the code with the time left', () => {
    expect(stageOf({}).kind).toBe('ready');
    expect(stageOf({ started })).toEqual({
      kind: 'code',
      pairing: started,
      remainingMs: 120_000,
      expiring: false,
    });
  });

  it('nudges in the last twenty seconds and ends when the code runs out', () => {
    expect(stageOf({ started, now: NOW + 101_000 })).toMatchObject({
      kind: 'code',
      expiring: true,
    });
    expect(stageOf({ started, now: NOW + 120_000 })).toMatchObject({
      kind: 'ended',
      ending: 'expired',
    });
  });

  it('shows a waiting phone before anything else, even after a reload lost the code', () => {
    expect(stageOf({ pending: [request] })).toEqual({ kind: 'found', request });
    expect(stageOf({ started, pending: [request], now: NOW + 500_000 }).kind).toBe('found');
  });

  it('holds the paired moment over the list, and an ending over a stale code', () => {
    expect(stageOf({ paired: 'Kitchen phone', pending: [request] })).toEqual({
      kind: 'paired',
      deviceName: 'Kitchen phone',
    });
    const ended = { ending: 'denied', reason: 'You said no.' } as const;
    expect(stageOf({ ended, started })).toMatchObject({ kind: 'ended', ending: 'denied' });
  });
});

describe('pairing scene copy', () => {
  it('gives each stage a pose and one line', () => {
    const stages = [
      stageOf({ status: 'off' }),
      stageOf({}),
      stageOf({ started }),
      stageOf({ started, now: NOW + 110_000 }),
      stageOf({ pending: [request] }),
      stageOf({ paired: 'Kitchen phone' }),
      stageOf({ started, now: NOW + 130_000 }),
    ];
    expect(stages.map(stageMood)).toEqual(['sleep', null, null, 'alert', null, 'happy', 'sad']);
    expect(stages.map(stageLine)).toEqual([
      'Turn phone access on to pair a phone.',
      'Ready when you are.',
      'Scan this with your phone, or type the code.',
      'This code is about to run out.',
      'Kitchen phone wants to pair. Same code on your phone?',
      'Kitchen phone is paired.',
      'That code ran out before a phone used it.',
    ]);
  });

  it('formats the countdown', () => {
    expect(countdownText(120_000)).toBe('2:00');
    expect(countdownText(59_001)).toBe('1:00');
    expect(countdownText(9_000)).toBe('0:09');
    expect(countdownText(-5)).toBe('0:00');
  });
});
