import type { AgentModeOption } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { PublishGrant } from '../approvals/publish-policy.ts';
import { saveSnapshot, type RunSnapshot } from '../persistence/run-snapshots.ts';
import { backupBeforeEdit, snapshotRun } from '../projects/run-changes.ts';
import type { QuestionGate } from '../providers/provider.ts';
import type { Append } from './agent-turn.ts';
import {
  createApprovalGate,
  type ApprovalGate,
  type EditObserver,
  type PlanModeHooks,
} from './approval-gate.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { askTurnAutoWhy } from './ask-auto.ts';
import type { ParkForUser } from './background-parking.ts';
import { createQuestionGate } from './question-gate.ts';
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
  park?: ParkForUser | undefined;
}

export interface AskTurnOptions extends AskRunOptions {
  conversationId: string;
}

export interface DoRunOptions extends AskRunOptions {
  changesProject?: boolean | undefined;
  projectRoots: readonly string[];
  backupAlsoFor?: string | undefined;
  observe?: EditObserver | undefined;
  plans?: PlanModeHooks | undefined;
  publish?: PublishGrant | undefined;
  snapshot?: RunSnapshot | undefined;
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
    ...(options.park ? { park: options.park } : {}),
  };
}

export function prepareAskRun(options: AskTurnOptions): ApprovalGate {
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

export async function prepareDoRun(options: DoRunOptions): Promise<ApprovalGate | undefined> {
  const root = options.projectRoots[0];
  if (!root) return undefined;
  const snapshot = options.snapshot ?? (await takeSnapshot(options.db, options.runId, root));
  return createApprovalGate({
    ...gateBasics(options),
    changesProject: options.changesProject === true,
    ...(options.observe ? { observe: options.observe } : {}),
    ...(options.plans ? { plans: options.plans } : {}),
    ...(options.publish ? { publish: options.publish } : {}),
    backup: async (paths) => {
      await backupBeforeEdit(options.db, options.runId, snapshot, paths);
      if (options.backupAlsoFor) {
        await backupBeforeEdit(options.db, options.backupAlsoFor, snapshot, paths);
      }
    },
  });
}

export function prepareQuestions(
  options: AskRunOptions,
  approvals: ApprovalGate | undefined,
): QuestionGate {
  const gate =
    approvals ?? createApprovalGate({ ...gateBasics(options), backup: async () => undefined });
  return createQuestionGate(options.db, options.runId, gate);
}
