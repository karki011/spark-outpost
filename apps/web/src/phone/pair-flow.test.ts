import { describe, expect, it } from 'vitest';
import type { PairingStart, PendingPairing } from '@spark-outpost/contracts';
import {
  activationOf,
  countdownText,
  motionMood,
  pairStage,
  stageLine,
  stageMotion,
  turnFailure,
  type PairFlowInput,
} from './pair-flow.ts';

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
    const moods = stages.map((stage) => motionMood(stageMotion(stage, null)));
    expect(moods).toEqual(['sleep', null, null, 'alert', null, 'happy', 'sad']);
    expect(stages.map((stage) => stageLine(stage))).toEqual([
      'Turn remote control on to pair a device.',
      'Ready when you are.',
      'Scan this with a phone, or open the address on the other device and type the code.',
      'This code is about to run out.',
      'Kitchen phone wants to pair. Same code on the device?',
      'Kitchen phone is paired.',
      'That code ran out before a device used it.',
    ]);
  });

  it('formats the countdown', () => {
    expect(countdownText(120_000)).toBe('2:00');
    expect(countdownText(59_001)).toBe('1:00');
    expect(countdownText(9_000)).toBe('0:09');
    expect(countdownText(-5)).toBe('0:00');
  });
});

describe('pairing scene motion', () => {
  const motionAt = (secondsLeft: number) =>
    stageMotion(stageOf({ started, now: NOW + 120_000 - secondsLeft * 1000 }), null);

  it('gives each stage its motion', () => {
    expect(stageMotion(stageOf({ status: 'off' }), null)).toBe('asleep');
    expect(stageMotion(stageOf({}), null)).toBe('ready');
    expect(stageMotion(stageOf({ started }), null)).toBe('idle');
    expect(stageMotion(stageOf({ pending: [request] }), null)).toBe('expectant');
    expect(stageMotion(stageOf({ paired: 'Kitchen phone' }), null)).toBe('happy');
    expect(stageMotion(stageOf({ started, now: NOW + 130_000 }), null)).toBe('shrug');
  });

  it('escalates with the time that is really left', () => {
    expect(motionAt(120)).toBe('idle');
    expect(motionAt(30.001)).toBe('idle');
    expect(motionAt(30)).toBe('alert');
    expect(motionAt(10.001)).toBe('alert');
    expect(motionAt(10)).toBe('urgent');
    expect(motionAt(0.001)).toBe('urgent');
    expect(motionAt(0)).toBe('shrug');
  });

  it('follows a later expiry instead of the time the code was first shown', () => {
    const renewed = { ...started, expiresAt: new Date(NOW + 200_000).toISOString() };
    expect(stageMotion(stageOf({ started: renewed, now: NOW + 115_000 }), null)).toBe('idle');
    expect(stageMotion(stageOf({ started: renewed, now: NOW + 175_000 }), null)).toBe('alert');
  });

  it('works while phone access is turning on or off, whatever the stage', () => {
    const on = { kind: 'pending', to: 'on' } as const;
    const off = { kind: 'pending', to: 'off' } as const;
    expect(stageMotion(stageOf({ status: 'off' }), on)).toBe('working');
    expect(stageMotion(stageOf({ started }), off)).toBe('working');
    expect(motionMood('working')).toBe('working');
    expect(stageLine(stageOf({ status: 'off' }), on)).toBe('Turning remote control on…');
    expect(stageLine(stageOf({}), off)).toBe('Turning remote control off…');
  });

  it('settles unsure with the reason when turning on failed', () => {
    const failed = { kind: 'failed', reason: 'serve config denied' } as const;
    const stage = stageOf({ status: 'error' });
    expect(stageMotion(stage, failed)).toBe('unsure');
    expect(motionMood('unsure')).toBe('sad');
    expect(stageLine(stage, failed)).toBe('serve config denied');
    expect(stageMotion(stageOf({}), failed)).toBe('ready');
  });

  it('reads the activation from the request in flight and the reported state', () => {
    const idle = { pending: null, failed: null };
    const off = { status: 'off', message: null } as const;
    expect(activationOf(idle, off)).toBeNull();
    expect(activationOf({ pending: 'on', failed: null }, off)).toEqual({
      kind: 'pending',
      to: 'on',
    });
    expect(activationOf({ pending: 'off', failed: 'on' }, off)).toEqual({
      kind: 'pending',
      to: 'off',
    });
    expect(activationOf({ pending: null, failed: 'on' }, off)).toEqual({
      kind: 'failed',
      reason: 'Remote control did not turn on.',
    });
    expect(activationOf(idle, { status: 'error', message: 'serve config denied' })).toEqual({
      kind: 'failed',
      reason: 'serve config denied',
    });
    expect(activationOf(idle, { status: 'error', message: null })).toEqual({
      kind: 'failed',
      reason: 'Remote control needs a look.',
    });
  });

  it('keeps a refused turn as a failure after the state reads off again', () => {
    const refused = { status: 'error', message: 'serve config denied' } as const;
    expect(turnFailure(null, undefined)).toBeNull();
    expect(turnFailure(null, { status: 'on', message: null })).toBeNull();
    expect(turnFailure(null, refused)).toBe('serve config denied');
    expect(turnFailure(null, { status: 'error', message: null })).toBe(
      'Remote control needs a look.',
    );
    expect(turnFailure(new Error('Mac did not answer'), undefined)).toBe('Mac did not answer');
    const failed = turnFailure(null, refused) === null ? null : ('on' as const);
    expect(activationOf({ pending: null, failed }, { status: 'off', message: null })).toEqual({
      kind: 'failed',
      reason: 'Remote control did not turn on.',
    });
  });
});
