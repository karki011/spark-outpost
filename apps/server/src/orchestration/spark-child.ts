import { ORCHESTRATION_ACTIVITY } from '@spark-outpost/contracts';
import type { Lease } from '../persistence/jobs.ts';
import { insertChildRun, loadOrchestration, type NewChild } from '../persistence/orchestrations.ts';
import { requestCancel } from '../persistence/runs.ts';
import type { MentionableSpark } from '../persistence/spark-mentions.ts';
import type { Append, RunControl, TurnResult } from '../workflow/agent-turn.ts';
import type { ChatTurnDeps } from '../workflow/chat-turn-hooks.ts';
import { executeChildRun } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';

export interface Handoff {
  deps: ChatTurnDeps;
  lease: Lease;
  input: RunInput;
  append: Append;
  control: RunControl;
}

export async function publishOrchestration(h: Handoff): Promise<void> {
  const view = await loadOrchestration(h.deps.db, h.lease.runId);
  if (view)
    await h.append(runEvents.activity(ORCHESTRATION_ACTIVITY, ORCHESTRATION_ACTIVITY, view));
}

export function pickFor(h: Handoff, spark: MentionableSpark) {
  const { input } = h;
  const own = spark.provider !== null && spark.connected && h.deps.providers.has(spark.provider);
  if (!own || spark.provider === input.provider) {
    const same = spark.provider === input.provider;
    return {
      provider: input.provider,
      model: (same ? spark.model : null) ?? input.settings.model,
      effort: (same ? spark.effort : null) ?? input.settings.effort,
    };
  }
  return { provider: spark.provider!, model: spark.model, effort: spark.effort };
}

export function hasProject(input: RunInput): boolean {
  return input.projectRoots.length > 0 && !input.chatFolder;
}

export async function runSparkChild(
  h: Handoff,
  child: Omit<NewChild, 'parentRunId'>,
  started?: (runId: string) => Promise<void>,
): Promise<TurnResult> {
  const lease = await insertChildRun(
    h.deps.db,
    { ...child, parentRunId: h.lease.runId },
    h.deps.leaseSeconds,
  );
  const stopNow = new AbortController();
  const cancel = () => {
    stopNow.abort();
    void requestCancel(h.deps.db, lease.runId).catch(() => undefined);
  };
  h.control.signal.addEventListener('abort', cancel, { once: true });
  if (h.control.signal.aborted) {
    stopNow.abort();
    await requestCancel(h.deps.db, lease.runId);
  }
  await started?.(lease.runId);
  await publishOrchestration(h);
  try {
    return await executeChildRun(h.deps, lease, { stopNow: stopNow.signal }, h.append);
  } finally {
    h.control.signal.removeEventListener('abort', cancel);
  }
}
