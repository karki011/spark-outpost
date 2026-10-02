import { applySparkEdits, type SparkAction, type SparkResult } from '@spark-outpost/contracts';
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
import { performSparkAction } from './perform.ts';

export interface SparkActionFollowThrough {
  wake(): void;
  stop(): Promise<void>;
}

const SWEEP_MS = 5_000;

export const RESTARTED_MESSAGE =
  'Spark restarted before it finished, so it may be half done. Check, then ask again or use Ship.';

async function audit(
  deps: SparkToolDeps,
  runId: string,
  action: SparkAction,
  result: SparkResult,
): Promise<void> {
  const payload = redactValue({ action, outcome: result.state, result });
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
    const performed = await performSparkAction(context, action);
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

export async function followThroughOnce(deps: SparkToolDeps): Promise<boolean> {
  const claimed = await claimSparkAction(deps.db);
  if (!claimed) return false;
  const result = await perform(deps, claimed);
  await finishSparkAction(deps.db, claimed.approval.id, result);
  const action = claimed.approval.payload.sparkAction!;
  await audit(deps, claimed.approval.runId, action, result).catch(() => undefined);
  return true;
}

export async function startSparkActionFollowThrough(
  deps: SparkToolDeps,
  sweepMs = SWEEP_MS,
): Promise<SparkActionFollowThrough> {
  await abandonRunningSparkActions(deps.db, RESTARTED_MESSAGE);
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  const drain = async () => {
    while (!stopped && (await followThroughOnce(deps).catch(() => false)));
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
    },
  };
}
