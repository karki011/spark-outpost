import type { AgentModeOption } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { PieceGuard } from '../approvals/piece-guard.ts';
import { saveSnapshot, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { backupBeforeEdit, snapshotRun } from '../projects/run-changes.ts';
import type { PermissionGate } from '../providers/provider.ts';
import type { Append } from './agent-turn.ts';
import { createApprovalGate, type EditObserver, type PlanModeHooks } from './approval-gate.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { askTurnAutoWhy } from './ask-auto.ts';
import type { RunObservations } from '../observations/run-observations.ts';

export interface AskRunOptions {
  db: Db;
  runId: string;
  provider: string;
  mode: string | null;
  modes?: readonly AgentModeOption[] | undefined;
  extraAllowlist?: (() => readonly string[]) | undefined;
  append: Append;
  waiters?: ApprovalWaiters | undefined;
  pollMs?: number | undefined;
  timeoutMs?: number | undefined;
  onTimeout: () => void;
  observations?: RunObservations | undefined;
}

export interface AskTurnOptions extends AskRunOptions {
  conversationId: string;
}

export interface DoRunOptions extends AskRunOptions {
  builder?: boolean | undefined;
  worktreeAuto?: boolean | undefined;
  projectRoots: readonly string[];
  backupAlsoFor?: string | undefined;
  copyOf?: string | null | undefined;
  observe?: EditObserver | undefined;
  plans?: PlanModeHooks | undefined;
  piece?: PieceGuard | undefined;
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

function gateBasics(options: AskRunOptions) {
  return {
    db: options.db,
    runId: options.runId,
    provider: options.provider,
    mode: options.mode,
    ...(options.modes ? { modes: options.modes } : {}),
    ...(options.extraAllowlist ? { extraAllowlist: options.extraAllowlist } : {}),
    append: options.append,
    waiters: options.waiters ?? new ApprovalWaiters(),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    onTimeout: options.onTimeout,
    ...(options.observations ? { observations: options.observations } : {}),
  };
}

export function prepareAskRun(options: AskTurnOptions): PermissionGate {
  return createApprovalGate({
    ...gateBasics(options),
    posture: 'read_only',
    askRun: true,
    askAuto: () =>
      askTurnAutoWhy({
        db: options.db,
        conversationId: options.conversationId,
        provider: options.provider,
        modes: options.modes ?? [],
      }),
    backup: async () => undefined,
  });
}

export async function prepareDoRun(options: DoRunOptions): Promise<PermissionGate | undefined> {
  const root = options.projectRoots[0];
  if (!root) return undefined;
  const snapshot = await takeSnapshot(options.db, options.runId, root);
  return createApprovalGate({
    ...gateBasics(options),
    builder: options.builder === true,
    worktreeAuto: options.worktreeAuto === true,
    copyOf: options.copyOf ?? null,
    ...(options.observe ? { observe: options.observe } : {}),
    ...(options.plans ? { plans: options.plans } : {}),
    ...(options.piece ? { piece: options.piece } : {}),
    backup: async (paths) => {
      await backupBeforeEdit(options.db, options.runId, snapshot, paths);
      if (options.backupAlsoFor) {
        await backupBeforeEdit(options.db, options.backupAlsoFor, snapshot, paths);
      }
    },
  });
}
