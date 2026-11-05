import type { AnnotationInput, Attachment } from '@spark-outpost/contracts';

export const SEND_SLOW_MS = 5_000;

export interface OutgoingMessage {
  id: string;
  content: string;
  attachments: Attachment[];
  annotations?: AnnotationInput[];
}

export interface SendAttempt {
  message: OutgoingMessage;
  status: 'idle' | 'pending' | 'success' | 'error';
  error: string | null;
  submittedAt: number;
}

export type SendPhase = 'starting' | 'slow' | 'failed' | 'accepted';

export interface PendingSend {
  message: OutgoingMessage;
  phase: SendPhase;
  error: string | null;
  submittedAt: number;
}

function latest(attempts: SendAttempt[]): SendAttempt | undefined {
  return attempts.reduce<SendAttempt | undefined>(
    (best, attempt) => (!best || attempt.submittedAt >= best.submittedAt ? attempt : best),
    undefined,
  );
}

function pendingSend(attempts: SendAttempt[], now: number): PendingSend | null {
  const accepted = latest(attempts.filter((attempt) => attempt.status === 'success'));
  if (accepted) {
    return {
      message: accepted.message,
      phase: 'accepted',
      error: null,
      submittedAt: accepted.submittedAt,
    };
  }
  const inFlight = latest(attempts.filter((attempt) => attempt.status === 'pending'));
  if (inFlight) {
    const slow = now - inFlight.submittedAt >= SEND_SLOW_MS;
    return {
      message: inFlight.message,
      phase: slow ? 'slow' : 'starting',
      error: null,
      submittedAt: inFlight.submittedAt,
    };
  }
  const failed = latest(attempts.filter((attempt) => attempt.status === 'error'));
  if (!failed) return null;
  return {
    message: failed.message,
    phase: 'failed',
    error: failed.error,
    submittedAt: failed.submittedAt,
  };
}

export function pendingSends(
  attempts: SendAttempt[],
  savedIds: ReadonlySet<string>,
  now: number,
): PendingSend[] {
  const byMessage = new Map<string, SendAttempt[]>();
  for (const attempt of [...attempts].sort((a, b) => a.submittedAt - b.submittedAt)) {
    if (savedIds.has(attempt.message.id)) continue;
    const group = byMessage.get(attempt.message.id) ?? [];
    group.push(attempt);
    byMessage.set(attempt.message.id, group);
  }
  return [...byMessage.values()].flatMap((group) => pendingSend(group, now) ?? []);
}

export function nextSlowAt(sends: PendingSend[]): number | null {
  const starting = sends.filter((send) => send.phase === 'starting');
  if (starting.length === 0) return null;
  return Math.min(...starting.map((send) => send.submittedAt + SEND_SLOW_MS));
}
