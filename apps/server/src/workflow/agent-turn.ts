import type { RunEvent } from '@spark-outpost/contracts';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { recordSuggestedTitle } from '../persistence/auto-title.ts';
import { renewLease, type Lease } from '../persistence/jobs.ts';
import {
  LeaseLostError,
  isCancelRequested,
  type AppendOptions,
} from '../persistence/run-events.ts';
import { ProviderError, type Provider, type ProviderOutput } from '../providers/provider.ts';
import { createTitleFilter } from '../titles/title-line.ts';
import { APPROVAL_TIMEOUT_MESSAGE, type EditObserver } from './approval-gate.ts';
import type { ApprovalWaiters } from './approval-waiters.ts';
import { createAuditRecorder } from './audit-recorder.ts';
import { prepareDoRun } from './do-run.ts';
import { runEvents } from './run-events.ts';
import type { RunInput } from './run-input.ts';
import {
  recordCapabilities,
  recordFollowedInstructions,
  recordRunMetrics,
  recordSessionSettings,
  recordTokens,
  recordUsage,
} from './run-metadata.ts';
import { proposedPlan } from '../plans/codex-plan.ts';
import { createPlanRecorder } from './plan-recorder.ts';
import { createTaskRecorder } from './task-recorder.ts';
import { createLiveCost } from '../usage/live-cost.ts';
import { prepareTurnSession, type TurnSession } from './turn-session.ts';
import type { SweepLimits } from '../persistence/provider-sessions.ts';
import { repoScanner } from '../agent-config/discovery.ts';
import { loadRepoLaunch } from '../agent-config/launch.ts';

export type Append = (event: RunEvent, options?: AppendOptions) => Promise<number>;

export interface TurnDeps {
  db: Db;
  providers: ReadonlyMap<string, Provider>;
  leaseSeconds: number;
  cancelPollMs?: number;
  approvalWaiters?: ApprovalWaiters;
  approvalPollMs?: number;
  approvalTimeoutMs?: number;
  sessionLimits?: SweepLimits;
}

export type StopReason = 'cancelled' | 'lease_lost' | 'approval_timeout' | 'budget';

export interface RunControl {
  signal: AbortSignal;
  reason(): StopReason | null;
  stop(reason: StopReason): void;
  dispose(): void;
}

export function startControl(deps: TurnDeps, lease: Lease): RunControl {
  const controller = new AbortController();
  let stopReason: StopReason | null = null;
  const stop = (reason: StopReason) => {
    stopReason ??= reason;
    controller.abort();
  };
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
    },
  };
}

export interface TurnOptions {
  onOutput?: (output: ProviderOutput) => void;
  backupAlsoFor?: string;
  recordsPlan?: boolean;
  observeEdits?: EditObserver | undefined;
  onLiveCost?: (usd: number) => void;
}

export interface TurnResult {
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'lease_lost';
  error: string | null;
  text: string;
  messageId: string | null;
}

const GENERIC_PROVIDER_FAILURE =
  'The provider stopped with an unexpected error. Nothing after the last completed step was changed.';

function failureMessage(error: unknown, reason: StopReason | null): string {
  if (reason === 'approval_timeout') return APPROVAL_TIMEOUT_MESSAGE;
  if (error instanceof ProviderError) return error.message;
  console.error('Run failed unexpectedly', error);
  return GENERIC_PROVIDER_FAILURE;
}

export async function runAgentTurn(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal' | 'reason' | 'stop'>,
  options: TurnOptions = {},
): Promise<TurnResult> {
  const tasks = createTaskRecorder(
    deps.db,
    lease.runId,
    input.prompt,
    append,
    options.recordsPlan ?? true,
  );
  const plans = createPlanRecorder({
    db: deps.db,
    runId: lease.runId,
    conversationId: input.identity.threadId,
    root: input.projectRoots[0] ?? null,
    taskId: () => tasks.taskId(),
    append,
  });
  const startedAt = Date.now();
  const live = createLiveCost(input.provider, input.settings.model);
  const meter = (output: ProviderOutput) => {
    if (live.observe(output)) options.onLiveCost?.(live.unreported());
  };
  const audit = createAuditRecorder({
    write: (entries) => insertProtocolEntries(deps.db, lease, entries),
  });
  let auditSettled = false;
  const settleAudit = async () => {
    if (auditSettled) return;
    auditSettled = true;
    if (control.reason() === 'lease_lost') return audit.discard();
    await audit.close();
    const estimate = control.signal.aborted ? live.unreported() : 0;
    options.onLiveCost?.(0);
    await recordRunMetrics(
      deps.db,
      lease.runId,
      { durationMs: Date.now() - startedAt, toolCallCount: audit.toolCallCount() },
      estimate,
    ).catch((error: unknown) => console.error('Could not record run metrics', error));
  };

  let messageId: string | null = null;
  let text = '';
  const titles = input.askTitle ? createTitleFilter() : null;
  const say = async (delta: string) => {
    if (!delta) return;
    if (!messageId) {
      messageId = newId();
      await append(runEvents.textStart(messageId));
    }
    text += delta;
    await append(runEvents.textContent(messageId, delta));
  };
  let turnSession: TurnSession | null = null;
  const ended = async (settled: TurnResult) => {
    await turnSession
      ?.finished(settled)
      .catch((error: unknown) => console.error('Could not record the agent session', error));
    return settled;
  };
  const result = (outcome: TurnResult['outcome'], error: string | null = null): TurnResult => ({
    outcome,
    error,
    text,
    messageId,
  });
  try {
    if (await isCancelRequested(deps.db, lease.runId)) control.stop('cancelled');
    if (control.signal.aborted && control.reason() !== 'lease_lost') {
      await settleAudit();
      return result('cancelled');
    }
    const provider = deps.providers.get(input.provider);
    if (!provider) throw new ProviderError(`Provider "${input.provider}" is not available.`);
    const approvals =
      input.mode === 'do'
        ? await prepareDoRun({
            db: deps.db,
            runId: lease.runId,
            level: input.level,
            builder: input.role === 'builder',
            projectRoots: input.projectRoots,
            append,
            waiters: deps.approvalWaiters,
            pollMs: deps.approvalPollMs,
            timeoutMs: deps.approvalTimeoutMs,
            onTimeout: () => control.stop('approval_timeout'),
            backupAlsoFor: options.backupAlsoFor,
            copyOf: input.copyOf,
            observe: options.observeEdits,
            plans: plans.hooks,
          })
        : undefined;
    turnSession = await prepareTurnSession(deps.db, input, deps.sessionLimits);
    const session = turnSession;
    const repo = await loadRepoLaunch(
      deps.db,
      repoScanner,
      input.identity.threadId,
      input.projectRoots,
    ).catch(() => []);

    for await (const output of provider.run({
      prompt: input.prompt,
      attachments: input.attachments,
      history: input.history,
      settings: input.settings,
      projectRoots: input.projectRoots,
      signal: control.signal,
      audit,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.role === 'builder' ? { builder: true } : {}),
      ...(approvals ? { approvals } : {}),
      ...(input.askTitle ? { askTitle: true } : {}),
      ...(input.preamble ? { preamble: input.preamble } : {}),
      ...(session ? { session: session.target } : {}),
      ...(repo.length > 0 ? { repo } : {}),
    })) {
      meter(output);
      if (control.signal.aborted) {
        if (output.kind === 'tokens') await recordTokens(deps.db, lease.runId, output);
        if (output.kind === 'usage') {
          await recordUsage(deps.db, lease.runId, session ? session.usage(output) : output);
        }
        continue;
      }
      options.onOutput?.(output);
      if (output.kind === 'step_started') await append(runEvents.stepStarted(output.name));
      if (output.kind === 'step_finished') await append(runEvents.stepFinished(output.name));
      if (output.kind === 'capabilities') await recordCapabilities(deps.db, input, output.report);
      if (output.kind === 'usage') {
        await recordUsage(deps.db, lease.runId, session ? session.usage(output) : output);
      }
      if (output.kind === 'tokens') await recordTokens(deps.db, lease.runId, output);
      await tasks.observe(output);
      if (output.kind === 'session') await session?.started(output);
      if (output.kind === 'commands') await session?.commands(output.commands);
      if (output.kind === 'session_settings') {
        await recordSessionSettings(deps.db, lease.runId, output);
      }
      if (output.kind === 'instructions') {
        await recordFollowedInstructions(deps.db, lease.runId, output.files);
      }
      if (output.kind === 'text_delta')
        await say(titles ? titles.push(output.delta) : output.delta);
    }
    if (titles) {
      const ending = titles.finish();
      await say(ending.text);
      if (ending.title) await recordSuggestedTitle(deps.db, lease.runId, ending.title);
    }

    if (control.reason() === 'approval_timeout') throw new ProviderError(APPROVAL_TIMEOUT_MESSAGE);
    await settleAudit();
    if (control.reason() === 'lease_lost') return result('lease_lost');
    await tasks.replied(text);
    const codexPlan = proposedPlan(text);
    if (codexPlan) await plans.propose(codexPlan, 'codex');
    return await ended(result(control.signal.aborted ? 'cancelled' : 'succeeded'));
  } catch (error) {
    if (error instanceof LeaseLostError || control.reason() === 'lease_lost') {
      audit.discard();
      return result('lease_lost');
    }
    await settleAudit();
    const reason = control.reason();
    if (reason === 'cancelled' || reason === 'budget') return ended(result('cancelled'));
    return ended(result('failed', failureMessage(error, reason)));
  } finally {
    audit.discard();
  }
}
