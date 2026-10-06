import type { PairingStart, PendingPairing, TailscaleStatus } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';

export const EXPIRING_MS = 20_000;

export type PairEnding = 'denied' | 'expired' | 'failed';

export type PairStage =
  | { kind: 'setup' }
  | { kind: 'ready' }
  | { kind: 'code'; pairing: PairingStart; remainingMs: number; expiring: boolean }
  | { kind: 'found'; request: PendingPairing }
  | { kind: 'paired'; deviceName: string }
  | { kind: 'ended'; ending: PairEnding; reason: string };

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

export function stageMood(stage: PairStage): ScoutMood {
  if (stage.kind === 'setup') return 'sleep';
  if (stage.kind === 'paired') return 'happy';
  if (stage.kind === 'ended') return 'sad';
  if (stage.kind === 'code' && stage.expiring) return 'alert';
  return null;
}

export function stageLine(stage: PairStage): string {
  switch (stage.kind) {
    case 'setup':
      return 'Turn phone access on to pair a phone.';
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
