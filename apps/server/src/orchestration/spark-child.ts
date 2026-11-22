import { ORCHESTRATION_ACTIVITY, type InvolvementLevel } from '@spark-outpost/contracts';
import type { Lease } from '../persistence/jobs.ts';
import { insertChildRun, loadOrchestration, type NewChild } from '../persistence/orchestrations.ts';
import { requestCancel } from '../persistence/runs.ts';
import type { MentionableSpark } from '../persistence/spark-mentions.ts';
import type { Append, RunControl, TurnResult } from '../workflow/agent-turn.ts';
import type { ChatTurnDeps } from '../workflow/chat-turn-hooks.ts';
import { executeChildRun } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { sparkRunSettings, type SparkRunSettings } from './spark-settings.ts';

export const SPARK_CHILD_LEVEL: InvolvementLevel = 'hands-off';

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

export interface SettingsPlace {
  provider: string;
  model: string | null;
  effort: string | null;
  agentMode: string | null;
}

function runPlace(input: RunInput): SettingsPlace {
  return {
    provider: input.provider,
    model: input.settings.model,
    effort: input.settings.effort,
    agentMode: input.agentMode,
  };
}

export function settingsFor(
  h: Handoff,
  spark: MentionableSpark,
  where: { inChat: boolean; appliesOwnMode: boolean; place?: SettingsPlace | null },
): SparkRunSettings {
  const { place, ...rest } = where;
  return sparkRunSettings(
    {
      ...(place ?? runPlace(h.input)),
      usable: (provider) => h.deps.providers.has(provider),
      ...rest,
    },
    spark,
  );
}

export function childFields(settings: SparkRunSettings) {
  return {
    provider: settings.provider,
    model: settings.model,
    effort: settings.effort,
    agentMode: settings.agentMode,
  };
}

export function settingsRoute(settings: SparkRunSettings) {
  return {
    agentMode: settings.agentMode,
    agentFrom: settings.agentFrom,
    modeFrom: settings.modeFrom,
  };
}

export function hasProject(input: RunInput): boolean {
  return input.projectRoots.length > 0 && !input.chatFolder;
}

export async function runSparkChild(
  h: Handoff,
  child: Omit<NewChild, 'parentRunId' | 'level'>,
  started?: (runId: string) => Promise<void>,
): Promise<TurnResult> {
  const lease = await insertChildRun(
    h.deps.db,
    { ...child, parentRunId: h.lease.runId, level: SPARK_CHILD_LEVEL },
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
