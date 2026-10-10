import type { RunSnapshot } from '../persistence/run-snapshots.ts';
import type { RunEvent } from '@spark-outpost/contracts';
import { sparkPreferences } from '../persistence/setup.ts';
import { teammateBrief } from '../persistence/teammate-chats.ts';
import { subagentBrief } from '../persistence/spark-mentions.ts';
import { auditSparkHandoff } from './spark-audit.ts';
import { briefWithFile } from '../projects/instructions-file.ts';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { recordSuggestedTitle } from '../persistence/auto-title.ts';
import type { Lease } from '../persistence/jobs.ts';
import {
  LeaseLostError,
  isCancelRequested,
  type AppendOptions,
} from '../persistence/run-events.ts';
import { ProviderError, type Provider, type ProviderOutput } from '../providers/provider.ts';
import { createTitleFilter } from '../titles/title-line.ts';
import { createRedactionFilter } from '../audit/redact-stream.ts';
import { projectSecretValues, withoutSecretValues } from '../audit/secret-values.ts';
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
import { publishGrant, publishScope, startBasis, withPublishNote } from './publish-context.ts';
import { watchUrgentNotes } from './steer-requests.ts';
import { joinSteering, openMemberInbox } from './member-inbox.ts';
import { recordAccount } from '../model-access/store.ts';
import { guardedRun, recordErrorDetails, recordModelSwitch } from './model-guard.ts';
import { createReplyText } from './reply-text.ts';
import type { RunInput } from './run-input.ts';
import {
  knownModes,
  recordCapabilities,
  recordFollowedInstructions,
  recordRunMetrics,
  recordSessionSettings,
  recordTokens,
  recordUsage,
} from './run-metadata.ts';
import { TEST_RUNNER_ALLOWLIST } from '../approvals/command-kinds.ts';
import { proposedPlan } from '../plans/codex-plan.ts';
import { crewPlansStayNotes, plansThisTurn } from '../plans/plan-mode.ts';
import { createPlanRecorder } from './plan-recorder.ts';
import { createTaskRecorder } from './task-recorder.ts';
import { createCommandRecorder } from './command-recorder.ts';
import { sparkCommandScope } from './command-scope.ts';
import { createTurnEvents } from './turn-events.ts';
import { createLiveCost } from '../usage/live-cost.ts';
import { turnSessionFor, type TurnSession } from './turn-session.ts';
import { asAgentReads } from '../outposts/agent-prompt.ts';
import { preambleDeps } from '../outposts/preamble-stores.ts';
import { withOutpostPreamble } from '../outposts/turn-preamble.ts';
import type { SweepLimits } from '../persistence/provider-sessions.ts';
import { repoScanner } from '../agent-config/discovery.ts';
import { loadRepoLaunch } from '../agent-config/launch.ts';
import { commandAllowlistFromRules } from '../agent-config/allow-rules.ts';
import { conversationProjectIds } from '../agent-config/store.ts';
import { loadUserMcp } from '../mcp/launch.ts';
import { withMoveNote } from './project-move.ts';
import { ASSISTANT_PREAMBLE } from '../companion/assistant.ts';
import { createRunObservations } from '../observations/run-observations.ts';
import { conversationHasSlackContext } from '../persistence/slack.ts';
import { SLACK_CONTEXT_OBSERVATION } from '../slack/thread.ts';
import { startRailFlags } from './rail-flags.ts';
import { withBrowserCheck } from './browser-check.ts';
import { observeSession } from './session-audit.ts';
import { watchedSends } from '../observations/send-watch.ts';
import { scannedObserver } from '../observations/output-scan.ts';
import type { RunControl, StopReason } from './run-control.ts';

export { startControl, type RunControl, type StopReason } from './run-control.ts';

export function writesCode(role: string | null | undefined): boolean {
  return role === 'builder' || role === 'integrator';
}

function editsFiles(input: RunInput): boolean {
  if (input.mode !== 'do' || input.assistant || plansThisTurn(input)) return false;
  return input.role === null || writesCode(input.role);
}

async function sessionBrief(db: Db, input: RunInput) {
  if (input.assistant) return null;
  if (input.parentRunId && input.role !== 'spark') return null;
  const brief = input.parentRunId
    ? await subagentBrief(db, input.identity.runId)
    : await teammateBrief(db, input.identity.threadId);
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
  browserPane?: boolean;
}

export interface TurnOptions {
  onOutput?: (output: ProviderOutput) => void;
  onProduced?: (output: ProviderOutput) => void;
  backupAlsoFor?: string;
  recordsPlan?: boolean;
  observeEdits?: EditObserver | undefined;
  stopNow?: AbortSignal;
  chatRun?: boolean;
  keepSnapshot?: RunSnapshot | undefined;
}

export interface TurnResult {
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'lease_lost';
  error: string | null;
  text: string;
  messageId: string | null;
  finalReply?: string | null;
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
    notesOnly: crewPlansStayNotes(input),
  });
  const startedAt = Date.now();
  const live = createLiveCost(input.provider, input.settings.model);
  const secretValues = await projectSecretValues(input.projectRoots);
  const audit = createAuditRecorder({
    write: (entries) =>
      insertProtocolEntries(
        deps.db,
        lease,
        entries.map((entry) => ({
          ...entry,
          payload: withoutSecretValues(entry.payload, secretValues),
        })),
      ),
  });
  const observations = createRunObservations({
    db: deps.db,
    runId: lease.runId,
    audit,
  });
  if (await conversationHasSlackContext(deps.db, input.identity.threadId).catch(() => false)) {
    observations.record({ source: 'private_data', label: SLACK_CONTEXT_OBSERVATION });
  }
  let auditSettled = false;
  const settleAudit = async () => {
    if (auditSettled) return;
    auditSettled = true;
    await observations.settled();
    if (control.reason() === 'lease_lost') return audit.discard();
    await audit.close();
    const estimate = control.signal.aborted ? live.unreported() : 0;
    await recordRunMetrics(
      deps.db,
      lease.runId,
      { durationMs: Date.now() - startedAt, toolCallCount: audit.toolCallCount() },
      estimate,
    ).catch((error: unknown) => console.error('Could not record run metrics', error));
  };

  const reply = createReplyText(append);
  const say = reply.say;
  const titles = input.askTitle ? createTitleFilter() : null;
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
    ...reply.result(),
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
  const redaction = createRedactionFilter(secretValues);
  const watch = { ...input, db: deps.db, runId: lease.runId, observations };
  const observer = watchedSends(scannedObserver(audit, secretValues, observations.record), watch);
  const sayText = (delta: string) => say(titles ? titles.push(delta) : delta);
  const replySoFar = () => ({
    shown: reply.result().text,
    held: redaction.pending() + (titles?.pending() ?? 0),
  });
  const guard = { ...input, db: deps.db, runId: lease.runId, append };
  const commands = createCommandRecorder({ ...guard, secretValues, replySoFar });
  const events = createTurnEvents({ append, secretValues });
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
    const chatRun = options.chatRun === true && input.mode === 'do' && !writesCode(input.role);
    const asking = input.mode === 'ask' && input.role === null && input.projectRoots.length > 0;
    const approvals =
      input.mode === 'do'
        ? await prepareDoRun({
            ...gateOptions,
            builder: writesCode(input.role),
            chatRun,
            projectRoots: input.projectRoots,
            backupAlsoFor: options.backupAlsoFor,
            copyOf: input.copyOf,
            observe: options.observeEdits,
            plans: plans.hooks,
            piece: input.piece ?? undefined,
            publish: publishGrant(input),
            snapshot: options.keepSnapshot,
          })
        : asking
          ? prepareAskRun({ ...gateOptions, conversationId: input.identity.threadId })
          : undefined;
    const rails =
      input.mode === 'do'
        ? await startRailFlags({ ...input, db: deps.db, runId: lease.runId, audit })
        : null;
    const shown = asAgentReads(input);
    turnSession = await turnSessionFor(deps, shown);
    const session = turnSession;
    const recordSpend = async (output: Extract<ProviderOutput, { kind: 'usage' }>) => {
      const counted = session ? await session.usage(output) : output;
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
      teammate: await sessionBrief(deps.db, input),
    };
    auditSparkHandoff(audit, input, spark.teammate);
    const preamble = input.assistant
      ? ASSISTANT_PREAMBLE
      : withMoveNote({
          ...input,
          preamble: await withPublishNote(
            deps.db,
            await withOutpostPreamble(preambleDeps(deps.db, input.workspaceId), input),
          ),
        });

    if (input.modelSwitch) {
      await recordModelSwitch(deps.db, lease.runId, append, input.modelSwitch);
    }
    for await (const output of guardedRun(guard, provider, {
      prompt: withBrowserCheck({
        prompt: shown.prompt,
        userRequest: input.userRequest,
        editsFiles: editsFiles(input),
        browserPane: deps.browserPane === true,
      }),
      attachments: input.attachments,
      history: input.seed ? input.history.slice(input.seed.historyFrom) : input.history,
      settings: input.settings,
      projectRoots: input.projectRoots,
      signal: control.signal,
      observe: (output) => {
        if (output.kind === 'session') session?.noteSession(output);
        options.onProduced?.(output);
      },
      audit: observer,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(writesCode(input.role) ? { builder: true } : {}),
      ...(chatRun ? { chatRun: true } : {}),
      ...(input.piece?.coordinated ? { coordinated: true } : {}),
      ...(input.piece?.sharesTree ? { sharesTree: true } : {}),
      ...((writesCode(input.role) || chatRun) && startBasis(input) ? { publishes: true } : {}),
      ...(input.builderEnv ? { env: input.builderEnv } : {}),
      ...(plansThisTurn(input) ? { planning: true } : {}),
      ...(input.plansFirst ? { plansFirst: true } : {}),
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
        publish: await publishScope(deps.db, input),
        commands: await sparkCommandScope(deps.db, lease.runId, input, { observations }),
        actions: {
          append,
          waiters: deps.approvalWaiters ?? new ApprovalWaiters(),
          signal: control.signal,
          timeoutMs: deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
          pollMs: deps.approvalPollMs ?? APPROVAL_POLL_MS,
          onTimeout: () => control.stop('approval_timeout'),
          audit,
          replySoFar,
        },
      },
    })) {
      if (control.signal.aborted) {
        live.observe(output);
        if (output.kind === 'tokens') await recordTokens(deps.db, lease.runId, output);
        if (output.kind === 'usage') await recordSpend(output);
        continue;
      }
      options.onOutput?.(output);
      await events.observe(output);
      if (output.kind === 'capabilities') await recordCapabilities(deps.db, input, output.report);
      if (output.kind === 'usage') await recordSpend(output);
      if (output.kind === 'tokens') await recordTokens(deps.db, lease.runId, output);
      live.observe(output);
      await tasks.observe(output);
      await observeSession({ audit, input, session }, output);
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
      if (output.kind === 'secret_read') {
        for (const label of output.paths) observations.record({ source: 'secret_file', label });
      }
      if (output.kind === 'account') {
        await recordAccount(deps.db, input.workspaceId, input.provider, output.account);
      }
      if (output.kind === 'text_delta') {
        reply.mark(output.phase, replySoFar().held);
        await sayText(redaction.push(output.delta));
      }
      await commands.observe(output);
    }
    await events.close();
    await commands.close();
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
    const { text } = reply.result();
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
    await events.close().catch(() => undefined);
    await commands.close().catch(() => undefined);
    await settleAudit();
    const reason = control.reason();
    if (reason === 'cancelled') return ended(result('cancelled'));
    await recordErrorDetails(deps.db, lease.runId, error).catch(() => undefined);
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
