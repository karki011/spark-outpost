import type { PairingStart, PendingPairing, TailscaleStatus } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';

export const EXPIRING_MS = 20_000;
export const ALERT_MS = 30_000;
export const URGENT_MS = 10_000;

export type PairEnding = 'denied' | 'expired' | 'failed';

export type PairStage =
  | { kind: 'setup' }
  | { kind: 'ready' }
  | { kind: 'code'; pairing: PairingStart; remainingMs: number; expiring: boolean }
  | { kind: 'found'; request: PendingPairing }
  | { kind: 'paired'; deviceName: string }
  | { kind: 'ended'; ending: PairEnding; reason: string };

export type Activation =
  { kind: 'pending'; to: 'on' | 'off' } | { kind: 'failed'; reason: string } | null;

export type PairMotion =
  | 'asleep'
  | 'working'
  | 'unsure'
  | 'ready'
  | 'idle'
  | 'alert'
  | 'urgent'
  | 'expectant'
  | 'happy'
  | 'shrug';

export interface PairFlowInput {
  status: TailscaleStatus | undefined;
  started: PairingStart | null;
  pending: readonly PendingPairing[];
  paired: string | null;
  ended: { ending: PairEnding; reason: string } | null;
  now: number;
}

export const ENDING_REASONS: Record<PairEnding, string> = {
  denied: 'You said no, so nothing was paired.',
  expired: 'That code ran out before a phone used it.',
  failed: 'Pairing did not start.',
};

export function pairStage(input: PairFlowInput): PairStage {
  if (input.status !== 'on') return { kind: 'setup' };
  if (input.paired !== null) return { kind: 'paired', deviceName: input.paired };
  const request = input.pending[0];
  if (request) return { kind: 'found', request };
  if (input.ended) return { kind: 'ended', ...input.ended };
  if (!input.started) return { kind: 'ready' };
  const remainingMs = new Date(input.started.expiresAt).getTime() - input.now;
  if (remainingMs <= 0) {
    return { kind: 'ended', ending: 'expired', reason: ENDING_REASONS.expired };
  }
  return {
    kind: 'code',
    pairing: input.started,
    remainingMs,
    expiring: remainingMs <= EXPIRING_MS,
  };
}

export interface TurnRequest {
  pending: 'on' | 'off' | null;
  failed: 'on' | 'off' | null;
}

export function activationOf(
  turn: TurnRequest,
  state: { status: TailscaleStatus; message: string | null },
): Activation {
  if (turn.pending) return { kind: 'pending', to: turn.pending };
  if (turn.failed) return { kind: 'failed', reason: `Phone access did not turn ${turn.failed}.` };
  if (state.status === 'error') {
    return { kind: 'failed', reason: state.message ?? 'Phone access needs a look.' };
  }
  return null;
}

export function stageMotion(stage: PairStage, activation: Activation): PairMotion {
  if (activation?.kind === 'pending') return 'working';
  switch (stage.kind) {
    case 'setup':
      return activation?.kind === 'failed' ? 'unsure' : 'asleep';
    case 'ready':
      return 'ready';
    case 'code':
      if (stage.remainingMs <= URGENT_MS) return 'urgent';
      return stage.remainingMs <= ALERT_MS ? 'alert' : 'idle';
    case 'found':
      return 'expectant';
    case 'paired':
      return 'happy';
    case 'ended':
      return 'shrug';
  }
}

const MOTION_MOODS: Record<PairMotion, ScoutMood> = {
  asleep: 'sleep',
  working: 'working',
  unsure: 'sad',
  ready: null,
  idle: null,
  alert: 'alert',
  urgent: 'alert',
  expectant: null,
  happy: 'happy',
  shrug: 'sad',
};

export function motionMood(motion: PairMotion): ScoutMood {
  return MOTION_MOODS[motion];
}

export function stageLine(stage: PairStage, activation: Activation = null): string {
  if (activation?.kind === 'pending') {
    return activation.to === 'on' ? 'Turning phone access on…' : 'Turning phone access off…';
  }
  switch (stage.kind) {
    case 'setup':
      return activation?.kind === 'failed'
        ? activation.reason
        : 'Turn phone access on to pair a phone.';
    case 'ready':
      return 'Ready when you are.';
    case 'code':
      return stage.expiring
        ? 'This code is about to run out.'
        : 'Scan this with your phone, or type the code.';
    case 'found':
      return `${stage.request.deviceName} wants to pair. Same code on your phone?`;
    case 'paired':
      return `${stage.deviceName} is paired.`;
    case 'ended':
      return stage.reason;
  }
}

export function countdownText(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
