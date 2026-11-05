import { renewLease, type Lease } from '../persistence/jobs.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import type { TurnDeps } from './agent-turn.ts';

export type StopReason = 'cancelled' | 'quit' | 'lease_lost' | 'approval_timeout';

export interface RunControl {
  signal: AbortSignal;
  reason(): StopReason | null;
  stop(reason: StopReason): void;
  dispose(): void;
}

export function startControl(deps: TurnDeps, lease: Lease, stopNow?: AbortSignal): RunControl {
  const controller = new AbortController();
  let stopReason: StopReason | null = null;
  const stop = (reason: StopReason) => {
    stopReason ??= reason;
    controller.abort();
  };
  const stopFromOutside = () => stop('cancelled');
  if (stopNow?.aborted) stopFromOutside();
  else stopNow?.addEventListener('abort', stopFromOutside, { once: true });
  const renewEveryMs = Math.max(1000, (deps.leaseSeconds * 1000) / 3);
  const heartbeat = setInterval(() => {
    renewLease(deps.db, lease, deps.leaseSeconds)
      .then((held) => {
        if (!held) stop('lease_lost');
      })
      .catch(() => undefined);
  }, renewEveryMs);
  const cancelWatch = setInterval(() => {
    isCancelRequested(deps.db, lease.runId)
      .then((requested) => {
        if (requested) stop('cancelled');
      })
      .catch(() => undefined);
  }, deps.cancelPollMs ?? 250);
  return {
    signal: controller.signal,
    reason: () => stopReason,
    stop,
    dispose() {
      clearInterval(heartbeat);
      clearInterval(cancelWatch);
      stopNow?.removeEventListener('abort', stopFromOutside);
    },
  };
}
