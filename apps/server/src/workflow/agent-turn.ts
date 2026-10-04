import { providerIdSchema, type AgentModeOption, type RunEvent } from '@spark-outpost/contracts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import { sparkPreferences } from '../persistence/setup.ts';
import { teammateBrief } from '../persistence/teammate-chats.ts';
import { briefWithFile } from '../projects/instructions-file.ts';
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
import { createRedactionFilter } from '../audit/redact-stream.ts';
import { projectSecretValues } from '../audit/secret-values.ts';
import {
  APPROVAL_POLL_MS,
  APPROVAL_TIMEOUT_MESSAGE,
  APPROVAL_TIMEOUT_MS,
  type EditObserver,
} from './approval-gate.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { createAuditRecorder } from './audit-recorder.ts';
import { prepareAskRun, prepareDoRun } from './do-run.ts';
import { watchModeRequests } from './mode-requests.ts';
import { publishGrant, startBasis } from './publish-context.ts';
import { watchUrgentNotes } from './steer-requests.ts';
import { joinSteering, openMemberInbox } from './member-inbox.ts';
import { createSpendMeter } from './spend-meter.ts';
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
import { TEST_RUNNER_ALLOWLIST } from '../approvals/command-kinds.ts';
import { proposedPlan } from '../plans/codex-plan.ts';
import { plansThisTurn } from '../plans/plan-mode.ts';
import { createPlanRecorder } from './plan-recorder.ts';
import { createTaskRecorder } from './task-recorder.ts';
import { createLiveCost } from '../usage/live-cost.ts';
import { prepareTurnSession, type TurnSession } from './turn-session.ts';
import type { SweepLimits } from '../persistence/provider-sessions.ts';
import { repoScanner } from '../agent-config/discovery.ts';
import { loadRepoLaunch } from '../agent-config/launch.ts';
import { commandAllowlistFromRules } from '../agent-config/allow-rules.ts';
import { conversationProjectIds } from '../agent-config/store.ts';
import { loadUserMcp } from '../mcp/launch.ts';
import { withMoveNote } from './project-move.ts';
import { ASSISTANT_PREAMBLE } from '../companion/assistant.ts';
import { createRunObservations } from '../observations/run-observations.ts';
import { startRailFlags } from './rail-flags.ts';
import { scannedObserver } from '../observations/output-scan.ts';

export function writesCode(role: string | null | undefined): boolean {
  return role === 'builder' || role === 'integrator';
}

async function mainSessionBrief(db: Db, input: RunInput) {
  if (input.parentRunId || input.assistant) return null;
  const brief = await teammateBrief(db, input.identity.threadId);
  return brief ? briefWithFile(brief) : null;
}

const INBOX_POLL_MS = 1000;

export type Append = (event: RunEvent, options?: AppendOptions) => Promise<number | null>;

export interface TurnDeps {
  db: Db;
  providers: ReadonlyMap<string, Provider>;
  leaseSeconds: number;
  cancelPollMs?: number;
  approvalWaiters?: ApprovalWaiters;
  approvalPollMs?: number;
  approvalTimeoutMs?: number;
  sessionLimits?: SweepLimits;
  inboxPollMs?: number;
}

export type StopReason = 'cancelled' | 'lease_lost' | 'approval_timeout' | 'budget';

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

export interface TurnOptions {
  onOutput?: (output: ProviderOutput) => void;
  onProduced?: (output: ProviderOutput) => void;
  backupAlsoFor?: string;
  recordsPlan?: boolean;
  observeEdits?: EditObserver | undefined;
  onLiveCost?: (usd: number, final: boolean) => void;
  stopNow?: AbortSignal;
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

async function knownModes(db: Db, input: RunInput): Promise<AgentModeOption[]> {
  const provider = providerIdSchema.safeParse(input.provider);
  if (!provider.success) return [];
  const captured = await getCapabilities(db, input.workspaceId, provider.data).catch(() => null);
  return captured?.modes ?? [];
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
  const spend = createSpendMeter(live, options.onLiveCost);
  const audit = createAuditRecorder({
    write: (entries) => insertProtocolEntries(deps.db, lease, entries),
  });
  const observations = createRunObservations({
    db: deps.db,
    runId: lease.runId,
    conversationId: input.identity.threadId,
    audit,
  });
  let auditSettled = false;
  const settleAudit = async () => {
    if (auditSettled) return;
    auditSettled = true;
    await observations.settled();
    if (control.reason() === 'lease_lost') return audit.discard();
    await audit.close();
    const estimate = control.signal.aborted ? live.unreported() : 0;
    options.onLiveCost?.(0, true);
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
      ?.finished({ ...settled, stopReason: control.reason() })
      .catch((error: unknown) => console.error('Could not record the agent session', error));
    return settled;
  };
  const result = (outcome: TurnResult['outcome'], error: string | null = null): TurnResult => ({
    outcome,
    error,
    text,
    messageId,
  });
  const modeWatch =
    input.mode === 'do' ? watchModeRequests(deps.db, lease.runId, deps.cancelPollMs ?? 250) : null;
  const steerWatch = input.piece?.coordinated
    ? watchUrgentNotes(deps.db, lease.runId, deps.cancelPollMs ?? 250, () =>
        control.stop('cancelled'),
      )
    : null;
  const inbox = input.assistant
    ? null
    : openMemberInbox(deps.db, {
        runId: lease.runId,
        topRunId: input.parentRunId ?? lease.runId,
        pollMs: deps.inboxPollMs ?? INBOX_POLL_MS,
        append,
      });
  const steering = joinSteering([steerWatch, inbox]);
  const secretValues = await projectSecretValues(input.projectRoots);
  const redaction = createRedactionFilter(secretValues);
  const observer = scannedObserver(audit, secretValues, observations.record);
  const sayText = (delta: string) => say(titles ? titles.push(delta) : delta);
  try {
    if (await isCancelRequested(deps.db, lease.runId)) control.stop('cancelled');
    if (control.signal.aborted && control.reason() !== 'lease_lost') {
      await settleAudit();
      return result('cancelled');
    }
    const provider = deps.providers.get(input.provider);
    if (!provider) throw new ProviderError(`Provider "${input.provider}" is not available.`);
    const repo = await loadRepoLaunch(
      deps.db,
      repoScanner,
      input.identity.threadId,
      input.projectRoots,
    ).catch(() => []);
    const trustedCommands = commandAllowlistFromRules(repo.flatMap((root) => root.allowRules));
    const gateOptions = {
      db: deps.db,
      runId: lease.runId,
      provider: input.provider,
      mode: input.agentMode,
      modes: await knownModes(deps.db, input),
      extraAllowlist: () => [...trustedCommands, ...TEST_RUNNER_ALLOWLIST],
      append,
      waiters: deps.approvalWaiters,
      pollMs: deps.approvalPollMs,
      timeoutMs: deps.approvalTimeoutMs,
      onTimeout: () => control.stop('approval_timeout'),
      observations,
    };
    const asking = input.mode === 'ask' && input.role === null && input.projectRoots.length > 0;
    const approvals =
      input.mode === 'do'
        ? await prepareDoRun({
            ...gateOptions,
            builder: writesCode(input.role),
            projectRoots: input.projectRoots,
            backupAlsoFor: options.backupAlsoFor,
            copyOf: input.copyOf,
            observe: options.observeEdits,
            plans: plans.hooks,
            piece: input.piece ?? undefined,
            publish: publishGrant(input),
          })
        : asking
          ? prepareAskRun({ ...gateOptions, conversationId: input.identity.threadId })
          : undefined;
    const rails =
      input.mode === 'do'
        ? await startRailFlags({ ...input, db: deps.db, runId: lease.runId, audit })
        : null;
    turnSession = await prepareTurnSession(deps.db, input, deps.sessionLimits);
    const session = turnSession;
    const recordSpend = async (output: Extract<ProviderOutput, { kind: 'usage' }>) => {
      const counted = session ? session.usage(output) : output;
      spend.recording(counted);
      await recordUsage(deps.db, lease.runId, counted);
    };
    const userMcp = input.assistant
      ? []
      : await loadUserMcp(
          deps.db,
          input.identity.threadId,
          await conversationProjectIds(deps.db, input.identity.threadId),
        ).catch(() => []);
    const spark = {
      ...(await sparkPreferences(deps.db, input.workspaceId)),
      teammate: await mainSessionBrief(deps.db, input),
    };
    const preamble = input.assistant ? ASSISTANT_PREAMBLE : withMoveNote(input);

    for await (const output of provider.run({
      prompt: input.prompt,
      attachments: input.attachments,
      history: input.seed ? input.history.slice(input.seed.historyFrom) : input.history,
      settings: input.settings,
      projectRoots: input.projectRoots,
      signal: control.signal,
      observe: (output) => {
        if (output.kind === 'session') session?.noteSession(output);
        spend.produced(output.kind === 'usage' && session ? session.usage(output) : output);
        options.onProduced?.(output);
      },
      audit: observer,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(writesCode(input.role) ? { builder: true } : {}),
      ...(input.piece?.coordinated ? { coordinated: true } : {}),
      ...(input.piece?.sharesTree ? { sharesTree: true } : {}),
      ...(writesCode(input.role) && startBasis(input) ? { publishes: true } : {}),
      ...(input.builderEnv ? { env: input.builderEnv } : {}),
      ...(plansThisTurn(input) ? { planning: true } : {}),
      ...(approvals ? { approvals } : {}),
      ...(approvals && modeWatch ? { modeRequests: modeWatch } : {}),
      ...(steering ? { steering } : {}),
      ...(inbox ? { inbox } : {}),
      ...(input.askTitle ? { askTitle: true } : {}),
      ...(preamble ? { preamble } : {}),
      ...(session ? { session: session.target } : {}),
      ...(repo.length > 0 ? { repo } : {}),
      ...(userMcp.length > 0 ? { userMcp } : {}),
      spark,
      sparkScope: {
        workspaceId: input.workspaceId,
        conversationId: input.identity.threadId,
        runId: lease.runId,
        ...(input.assistant ? { readOnly: true } : {}),
        observations,
        actions: {
          append,
          waiters: deps.approvalWaiters ?? new ApprovalWaiters(),
          signal: control.signal,
          timeoutMs: deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
          pollMs: deps.approvalPollMs ?? APPROVAL_POLL_MS,
          audit,
        },
      },
    })) {
      if (control.signal.aborted) {
        spend.read(output);
        if (output.kind === 'tokens') await recordTokens(deps.db, lease.runId, output);
        if (output.kind === 'usage') await recordSpend(output);
        continue;
      }
      options.onOutput?.(output);
      if (output.kind === 'step_started') await append(runEvents.stepStarted(output.name));
      if (output.kind === 'step_finished') await append(runEvents.stepFinished(output.name));
      if (output.kind === 'capabilities') await recordCapabilities(deps.db, input, output.report);
      if (output.kind === 'usage') await recordSpend(output);
      if (output.kind === 'tokens') await recordTokens(deps.db, lease.runId, output);
      spend.read(output);
      await tasks.observe(output);
      if (output.kind === 'session') await session?.started(output);
      if (output.kind === 'commands') await session?.commands(output.commands);
      if (output.kind === 'plan_proposed') {
        await plans.propose(output.plan, output.source, output.toolCallId);
      }
      if (output.kind === 'session_settings') {
        await recordSessionSettings(deps.db, lease.runId, output);
      }
      if (output.kind === 'instructions') {
        await recordFollowedInstructions(deps.db, lease.runId, output.files);
      }
      if (output.kind === 'rail_flag') await rails?.record(output.flag);
      if (output.kind === 'text_delta') await sayText(redaction.push(output.delta));
    }
    await rails?.finish();
    await sayText(redaction.finish());
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
    await sayText(redaction.finish()).catch((failure: unknown) =>
      console.error('Could not save the end of the reply', failure),
    );
    await settleAudit();
    const reason = control.reason();
    if (reason === 'cancelled' || reason === 'budget') return ended(result('cancelled'));
    return ended(result('failed', failureMessage(error, reason)));
  } finally {
    modeWatch?.dispose();
    steerWatch?.dispose();
    await inbox
      ?.dispose()
      .catch((error: unknown) => console.error('Could not close the message inbox', error));
    audit.discard();
  }
}
