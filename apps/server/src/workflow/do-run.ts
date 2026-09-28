import type { InvolvementLevel, RunEvent } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { AppendOptions } from '../persistence/run-events.ts';
import { saveSnapshot, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { backupBeforeEdit, snapshotRun } from '../projects/run-changes.ts';
import type { PermissionGate } from '../providers/provider.ts';
import { createApprovalGate, type EditObserver, type PlanModeHooks } from './approval-gate.ts';
import { ApprovalWaiters } from './approval-waiters.ts';

export interface DoRunOptions {
  db: Db;
  runId: string;
  level: InvolvementLevel;
  projectRoots: readonly string[];
  append: (event: RunEvent, options?: AppendOptions) => Promise<number>;
  waiters?: ApprovalWaiters | undefined;
  pollMs?: number | undefined;
  timeoutMs?: number | undefined;
  onTimeout: () => void;
  backupAlsoFor?: string | undefined;
  copyOf?: string | null | undefined;
  observe?: EditObserver | undefined;
  plans?: PlanModeHooks | undefined;
}

export async function takeSnapshot(db: Db, runId: string, root: string): Promise<RunSnapshot> {
  try {
    return await snapshotRun(db, runId, root);
  } catch (error) {
    console.error(`Could not take a git snapshot for run ${runId}; recording file copies`, error);
    const snapshot: RunSnapshot = { kind: 'files', ref: null, root };
    await saveSnapshot(db, runId, snapshot);
    return snapshot;
  }
}

export async function prepareDoRun(options: DoRunOptions): Promise<PermissionGate | undefined> {
  const root = options.projectRoots[0];
  if (!root) return undefined;
  const snapshot = await takeSnapshot(options.db, options.runId, root);
  return createApprovalGate({
    db: options.db,
    runId: options.runId,
    level: options.level,
    append: options.append,
    waiters: options.waiters ?? new ApprovalWaiters(),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    onTimeout: options.onTimeout,
    copyOf: options.copyOf ?? null,
    ...(options.observe ? { observe: options.observe } : {}),
    ...(options.plans ? { plans: options.plans } : {}),
    backup: async (paths) => {
      await backupBeforeEdit(options.db, options.runId, snapshot, paths);
      if (options.backupAlsoFor) {
        await backupBeforeEdit(options.db, options.backupAlsoFor, snapshot, paths);
      }
    },
  });
}
