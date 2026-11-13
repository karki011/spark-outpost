import {
  applySparkEdits,
  crewEditConflicted,
  isAtlassianAction,
  isCalendarAction,
  type SparkAction,
  type SparkActionName,
  type SparkResult,
} from '@spark-outpost/contracts';
import { redactValue } from '../../audit/redact.ts';
import { insertFinishedRunEntries } from '../../persistence/audit-log.ts';
import {
  abandonRunningSparkActions,
  claimSparkAction,
  finishSparkAction,
  type ClaimedSparkAction,
} from '../../persistence/spark-results.ts';
import { shipFailureMessage } from '../../ship/failure-hint.ts';
import type { SparkToolDeps } from '../deps.ts';
import { auditedAction } from './confirm.ts';
import { performSparkAction } from './perform.ts';

export interface SparkActionFollowThrough {
  wake(): void;
  stop(): Promise<void>;
}

const SWEEP_MS = 5_000;
const DETACHED: ReadonlySet<SparkActionName> = new Set(['clone_repo']);

export const RESTARTED_MESSAGE = 'Spark restarted before this finished, so it may be half done.';

function outcomeOf(action: SparkAction, result: SparkResult): string {
  const conflicted = action.action === 'crew_edit' && crewEditConflicted(result.message);
  return conflicted ? 'conflict' : result.state;
}

async function audit(
  deps: SparkToolDeps,
  runId: string,
  action: SparkAction,
  result: SparkResult,
): Promise<void> {
  const lean =
    isCalendarAction(action.action) ||
    isAtlassianAction(action.action) ||
    action.action === 'plugins_edit' ||
    action.action === 'crew_edit' ||
    action.action === 'link_repo' ||
    action.action === 'github_read' ||
    action.action === 'clone_repo';
  const payload = lean
    ? redactValue({
        action: auditedAction(action),
        outcome: outcomeOf(action, result),
        url: result.url,
      })
    : redactValue({ action, outcome: result.state, result });
  await insertFinishedRunEntries(deps.db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: `spark/${action.action}`,
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

async function perform(deps: SparkToolDeps, claimed: ClaimedSparkAction): Promise<SparkResult> {
  const { approval } = claimed;
  const action = applySparkEdits(approval.payload.sparkAction!, approval.edits ?? null);
  const context = {
    deps,
    scope: {
      workspaceId: claimed.workspaceId,
      conversationId: claimed.conversationId,
      runId: approval.runId,
    },
  };
  try {
    const startedBy = approval.decidedBy === 'level' ? 'agent' : 'user';
    const performed = await performSparkAction(context, action, startedBy);
    return {
      state: 'done',
      message: performed.message,
      url: performed.url,
      ...(performed.output ? { output: performed.output } : {}),
    };
  } catch (error) {
    return { state: 'failed', message: shipFailureMessage(error).slice(0, 2000), url: null };
  }
}

async function settle(deps: SparkToolDeps, claimed: ClaimedSparkAction): Promise<void> {
  const result = await perform(deps, claimed);
  await finishSparkAction(deps.db, claimed.approval.id, result);
  const action = claimed.approval.payload.sparkAction!;
  await audit(deps, claimed.approval.runId, action, result).catch(() => undefined);
}

export async function followThroughOnce(
  deps: SparkToolDeps,
  aside?: (work: Promise<void>) => void,
): Promise<boolean> {
  const claimed = await claimSparkAction(deps.db);
  if (!claimed) return false;
  const work = settle(deps, claimed);
  if (aside && DETACHED.has(claimed.approval.payload.sparkAction!.action)) aside(work);
  else await work;
  return true;
}

function failed(error: unknown): false {
  console.error('Spark could not follow through on a confirmed action', error);
  return false;
}

export async function startSparkActionFollowThrough(
  deps: SparkToolDeps,
  sweepMs = SWEEP_MS,
): Promise<SparkActionFollowThrough> {
  await abandonRunningSparkActions(deps.db, RESTARTED_MESSAGE);
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  const asides = new Set<Promise<void>>();
  const aside = (work: Promise<void>) => {
    const tracked = work.catch(failed).then(() => {
      asides.delete(tracked);
    });
    asides.add(tracked);
  };

  const drain = async () => {
    while (!stopped && (await followThroughOnce(deps, aside).catch(failed)));
  };

  const wake = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = drain().finally(() => {
      running = null;
      if (again) {
        again = false;
        wake();
      }
    });
  };

  const timer = setInterval(wake, sweepMs);
  timer.unref();
  wake();
  return {
    wake,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
      await Promise.all(asides);
    },
  };
}
