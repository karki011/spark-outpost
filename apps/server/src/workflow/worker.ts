import type { ActiveWork } from '../diagnostics/event-loop-lag.ts';
import { executeDigest } from '../digest/execute.ts';
import type { Db } from '../persistence/db.ts';
import { isDigestRun } from '../persistence/digests.ts';
import { claimNextJob, type Lease } from '../persistence/jobs.ts';
import { cleanOrphanedCopies } from '../orchestration/solo-copy.ts';
import { sweepChatWorktrees } from '../projects/chat-worktree-cleanup.ts';
import { orchestrate } from '../orchestration/orchestrator.ts';
import type { OrchestratorDeps } from '../orchestration/session.ts';
import { recoverExpiredLeases } from './recovery.ts';
import { sweepSessions } from './turn-session.ts';
import type { ParkedTurns } from './parked-turns.ts';
import { chatTarget, drainQueue, drainWaiting, type ResolveTarget } from './queue-drain.ts';

export interface WorkerOptions extends OrchestratorDeps {
  concurrency: number;
  pollMs?: number;
  recoveryEveryMs?: number;
  activeWork?: ActiveWork;
  queueTarget?: ResolveTarget;
  parked?: ParkedTurns;
}

export interface Worker {
  wake(): void;
  stop(): Promise<void>;
  idle(): Promise<void>;
}

async function runLease(options: WorkerOptions, lease: Lease): Promise<void> {
  if (await isDigestRun(options.db, lease.runId)) return executeDigest(options, lease);
  await orchestrate(options, lease);
  await sendNextQueued(options, lease.runId);
}

async function sendNextQueued(options: WorkerOptions, runId: string): Promise<void> {
  const { rows } = await options.db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM runs WHERE id = $1 AND parent_run_id IS NULL',
    [runId],
  );
  const conversationId = rows[0]?.conversation_id;
  if (!conversationId) return;
  await drainQueue(options.db, conversationId, queueTarget(options)).catch((error: unknown) =>
    console.error(`Could not send the queued message for chat ${conversationId}`, error),
  );
}

function queueTarget(options: WorkerOptions): ResolveTarget {
  return options.queueTarget ?? chatTarget(options.db);
}

export function startWorker(options: WorkerOptions): Worker {
  const active = new Set<Promise<void>>();
  let stopped = false;
  let wakeUp: (() => void) | null = null;
  let lastRecovery = 0;

  const wake = () => {
    wakeUp?.();
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const working = () => active.size - (options.parked?.size ?? 0);

  const fillSlots = async (db: Db) => {
    while (!stopped && working() < options.concurrency) {
      const lease = await claimNextJob(db, options.leaseSeconds);
      if (!lease) return;
      const done = options.activeWork?.begin(`run ${lease.runId}`);
      const task = runLease(options, lease)
        .catch((error) => console.error(`Run ${lease.runId} crashed`, error))
        .finally(() => {
          done?.();
          active.delete(task);
          wake();
        });
      active.add(task);
    }
  };

  options.parked?.onChange(wake);

  const loop = (async () => {
    while (!stopped) {
      try {
        if (Date.now() - lastRecovery >= (options.recoveryEveryMs ?? 5000)) {
          lastRecovery = Date.now();
          const done = options.activeWork?.begin('recovery sweep');
          try {
            await recoverExpiredLeases(options.db);
            await cleanOrphanedCopies(options.db);
            await sweepChatWorktrees(options.db);
            await sweepSessions(options.db, options.sessionLimits);
            await drainWaiting(options.db, queueTarget(options));
          } finally {
            done?.();
          }
        }
        await fillSlots(options.db);
      } catch (error) {
        console.error('Worker loop error', error);
      }
      await sleep(options.pollMs ?? 1000);
    }
  })();

  return {
    wake,
    async stop() {
      stopped = true;
      wake();
      await loop;
      await Promise.allSettled([...active]);
    },
    async idle() {
      while (active.size > 0) await Promise.allSettled([...active]);
    },
  };
}
