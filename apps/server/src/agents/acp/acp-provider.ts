import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type { SecretStore } from '../../setup/secrets.ts';
import {
  ProviderError,
  type Provider,
  type ProviderOutput,
  type ProviderTurn,
} from '../../providers/provider.ts';
import { supportsDo, type AgentDefinition, type AgentLaunch } from './agents.ts';
import { AgentExitedError, startAgentProcess, type AgentProcess } from './agent-process.ts';
import { agentEnvironment } from './agent-env.ts';
import { longContextEnv } from './long-context.ts';
import { cliEnvironment, type CliLocator } from './agent-cli.ts';
import { CODEX_PLAIN_SANDBOX_NOTE, codexConfigFailed, prepareCodexLaunch } from './codex-launch.ts';
import { auditCodexInstructions, withClaudeSpark, withCodexSpark } from './spark-instructions.ts';
import {
  openSparkTools,
  sparkAcpServer,
  sparkReserved,
  withCodexSparkServer,
  type SparkTools,
  type SparkToolsAccess,
} from './spark-tools.ts';
import { Channel } from './channel.ts';
import {
  contextSteps,
  conversationBlocks,
  followUpBlocks,
  promptSupport,
  promptText,
} from './conversation-prompt.ts';
import { AUTH_STATUS_METHOD, parseAuthStatus } from './auth-status.ts';
import { exitCause, type SignInCheck } from './exit-cause.ts';
import { assertProtocolVersion, failureError, namesCause } from './errors.ts';
import { declineInConversation, nativePlan } from './permissions.ts';
import { applySessionSettings, modeName, settingsOutputs } from './apply-settings.ts';
import { watchRanModel } from './ran-model.ts';
import { modeAllowed, modeWish, switchMode } from './session-modes.ts';
import { createRailWatch } from './rail-watch.ts';
import { asReported } from './reported-output.ts';
import { createCommandTracker } from './command-output.ts';
import { CLIENT_INFO, clientCapabilities } from './client-info.ts';
import { readTextFile, refuseWrite } from './fs-handlers.ts';
import {
  reviewPermission,
  runsCommand,
  writeWithApproval,
  type DoWorkspace,
} from './do-handlers.ts';
import { primaryRoot, type PathPolicy } from '../../projects/path-policy.ts';
import { newSessionRequest } from './session-request.ts';
import { extraRoots, openProject, sessionMeta } from './session-start.ts';
import { attachSteering, nextMessage, untilFailure } from './steering.ts';
import {
  namedMcpServers,
  prepareRepoSession,
  type NamedMcpServer,
  type RepoSession,
} from './repo-session.ts';
import { codexUserMcpNames } from './codex-mcp.ts';
import { resolveUserMcp } from '../../mcp/launch.ts';
import { childEnvironment } from '../../setup/environment.ts';
import {
  afterOpening,
  closeQuietly,
  openSession,
  replayFilter,
  sessionNote,
  sessionOutput,
  type ReplayFilter,
} from './session-open.ts';
import { createUpdateMapper, type UpdateMapper } from './session-updates.ts';
import { withToolCalls } from './tool-call-outputs.ts';
import { promptTokens } from './prompt-usage.ts';
import { slashPrompt } from './slash-commands.ts';

export interface AcpProviderOptions {
  definition: AgentDefinition;
  launch?: AgentLaunch;
  locateCli?: CliLocator;
  env?: Record<string, string>;
  secrets?: Pick<SecretStore, 'get'>;
  cancelGraceMs?: number;
  sparkTools?: SparkToolsAccess;
  signedIn?: SignInCheck;
}

const DEFAULT_CANCEL_GRACE_MS = 5_000;
const EXIT_WAIT_MS = 500;

export function createAcpProvider(options: AcpProviderOptions): Provider {
  return {
    name: options.definition.id,
    run: (turn) => runTurn(options, turn),
  };
}

async function* runTurn(options: AcpProviderOptions, turn: ProviderTurn) {
  if (turn.settings.method === 'api_key' && !options.definition.keyEnvironment) {
    throw new ProviderError(
      `Chats through a ${options.definition.name} API key aren't supported yet. Reconnect ${options.definition.name} with the local CLI.`,
    );
  }
  const channel = new Channel<ProviderOutput>(turn.observe);
  const abort = new AbortController();
  const forwardAbort = () => abort.abort();
  turn.signal.addEventListener('abort', forwardAbort, { once: true });
  if (turn.signal.aborted) abort.abort();
  const session = runSession(options, turn, abort.signal, channel, false);
  try {
    yield* channel;
  } finally {
    turn.signal.removeEventListener('abort', forwardAbort);
    abort.abort();
    await session;
  }
}

async function runSession(
  options: AcpProviderOptions,
  turn: ProviderTurn,
  signal: AbortSignal,
  channel: Channel<ProviderOutput>,
  legacyPermissions: boolean,
): Promise<void> {
  const { definition } = options;
  const mapper = withToolCalls(
    createUpdateMapper(definition.name, definition.longContext === true),
  );
  const push = (outputs: ProviderOutput[]) =>
    outputs.forEach((output) => channel.push(asReported(definition, output)));
  let agent: AgentProcess | null = null;
  let scratch: string | null = null;
  let launchDir: string | null = null;
  let retryWithoutProfiles = false;
  let spark: SparkTools | null = null;
  let graceTimer: NodeJS.Timeout | null = null;
  const onAbort = () => {
    graceTimer = setTimeout(() => agent?.kill(), options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    const linked = turn.projectRoots ?? [];
    const roots = openedRoots(definition, turn, linked);
    const browsing = roots.length > 0 && definition.readsProjectFolders;
    const policy = browsing ? await openProject(definition, roots) : null;
    const workdir = turn.session?.workdir ?? null;
    if (workdir) await mkdir(workdir, { recursive: true });
    else scratch = await mkdtemp(join(tmpdir(), 'spark-outpost-run-'));
    const home = workdir ?? scratch ?? tmpdir();
    const cwd = policy ? primaryRoot(policy) : home;
    const replay = replayFilter(turn.audit);
    const userMcp = await resolveUserMcp(turn.userMcp ?? [], options.secrets);
    const own =
      definition.repoStyle === 'codex'
        ? await codexUserMcpNames(options.env ?? childEnvironment(process.env))
        : [];
    spark = await openSparkTools(options.sparkTools, turn.sparkScope, own);
    const reserved = sparkReserved(own);
    const repo =
      policy && turn.repo
        ? await prepareRepoSession(
            turn.repo.filter((entry) => roots.includes(entry.root)),
            definition.repoStyle,
            userMcp,
            reserved,
          )
        : null;
    const mcpServers = repo?.mcpServers ?? namedMcpServers([], userMcp, reserved);
    const codex = withCodexSpark(repo?.codex ?? null, turn.spark, spark);
    if (definition.repoStyle === 'codex') auditCodexInstructions(turn.audit, codex);
    const builder = turn.builder === true;
    const located = options.launch ? {} : await cliEnvironment(definition, options.locateCli);
    if (definition.repoStyle === 'codex') launchDir = await mkdtemp(join(tmpdir(), 'spark-codex-'));
    const prepared =
      launchDir && located.CODEX_PATH
        ? await prepareCodexLaunch(located, launchDir, legacyPermissions)
        : { cli: located, profiles: !legacyPermissions };
    const cli = prepared.cli;
    const launchEnv = await agentEnvironment(
      { ...options, codexProfiles: prepared.profiles },
      home,
      browsing,
      codex,
      builder && turn.publishes !== true,
      turn.env,
    );
    if (definition.repoStyle === 'codex' && !prepared.profiles) {
      push(mapper.note(CODEX_PLAIN_SANDBOX_NOTE));
    }
    const env = withCodexSparkServer(
      { ...launchEnv, ...longContextEnv(definition, launchEnv, repo?.claude?.redirects), ...cli },
      definition.repoStyle === 'codex' ? spark : null,
    );
    agent = startAgentProcess(options.launch ?? definition.launch(), cwd, env, replay.observer);
    const notes = roots.length > 0 && !browsing ? [noFolderAccessNote(definition)] : [];
    if (roots.length < linked.length) notes.push(primaryOnlyNote(definition, roots[0]!));
    const changing = policy !== null && turn.mode === 'do';
    if (changing) assertCanChange(definition, turn);
    const workspace = { cwd, policy, notes, changing, replay, repo, mcpServers, spark };
    const stopReason = await Promise.race([
      converse(agent, definition, workspace, turn, signal, mapper, push),
      agent.exited,
    ]);
    push(mapper.finish(stopReason === 'cancelled'));
    const failure = mapper.failure() ?? (stopReason === 'end_turn' ? mapper.stalled() : null);
    if (failure && stopReason !== 'cancelled') throw failureError(definition.name, failure);
    if (stopReason === 'end_turn' && !mapper.repliedWithText()) {
      if (!mapper.didWork()) {
        throw new ProviderError(
          `${definition.name} finished without a reply. It may not be able to reach its model, so check that it's signed in and try again.`,
        );
      }
      push(mapper.note('Finished without a written reply'));
    }
    if (stopReason === 'max_tokens') push(mapper.note('Reply stopped at the length limit'));
    if (stopReason === 'refusal') {
      throw new ProviderError(`${definition.name} declined to answer this request.`);
    }
    if (stopReason === 'max_turn_requests') {
      throw new ProviderError(`${definition.name} stopped after reaching its turn limit.`);
    }
    channel.close();
  } catch (error) {
    const cause = signal.aborted || !agent ? error : await exitOr(agent, error);
    const tail = agent?.stderrTail() ?? '';
    retryWithoutProfiles =
      !signal.aborted &&
      definition.repoStyle === 'codex' &&
      !legacyPermissions &&
      !mapper.repliedWithText() &&
      !mapper.didWork() &&
      codexConfigFailed(cause, tail);
    if (!retryWithoutProfiles) {
      push(mapper.finish(true));
      const reported = cause instanceof ProviderError ? null : mapper.failure();
      if (signal.aborted) channel.close();
      else if (reported) channel.close(failureError(definition.name, reported));
      else channel.close(await exitCause(definition.name, cause, tail, turn, options.signedIn));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (graceTimer) clearTimeout(graceTimer);
    agent?.kill();
    spark?.grant.revoke();
    if (scratch) await rm(scratch, { recursive: true, force: true });
    if (launchDir) await rm(launchDir, { recursive: true, force: true });
  }
  if (retryWithoutProfiles) await runSession(options, turn, signal, channel, true);
}

async function exitOr(agent: AgentProcess, error: unknown): Promise<unknown> {
  if (namesCause(error)) return error;
  const exit = await Promise.race([
    agent.exited.catch((reason: unknown) => reason),
    delay(EXIT_WAIT_MS).then(() => null),
  ]);
  return exit instanceof AgentExitedError ? exit : error;
}

function openedRoots(
  definition: AgentDefinition,
  turn: ProviderTurn,
  linked: readonly string[],
): readonly string[] {
  return turn.mode === 'do' && definition.doPrimaryRootOnly ? linked.slice(0, 1) : linked;
}

export function primaryOnlyNote(definition: AgentDefinition, primary: string): string {
  return `${definition.name} changes only ${basename(primary)} in Do; the other linked repos aren't opened`;
}

function assertCanChange(definition: AgentDefinition, turn: ProviderTurn): void {
  if (!supportsDo(definition)) {
    throw new ProviderError(`${definition.name} can't make changes in Do mode yet.`);
  }
  if (!turn.approvals) {
    throw new ProviderError('Do mode needs the approval gate, so the run was stopped.');
  }
}

interface Workspace {
  cwd: string;
  policy: PathPolicy | null;
  notes: string[];
  changing: boolean;
  replay: ReplayFilter;
  repo: RepoSession | null;
  mcpServers: NamedMcpServer[];
  spark: SparkTools | null;
}

export function noFolderAccessNote(definition: AgentDefinition): string {
  return `${definition.name} can't browse project folders; attach files with @ instead`;
}

async function converse(
  agent: AgentProcess,
  definition: AgentDefinition,
  workspace: Workspace,
  turn: ProviderTurn,
  signal: AbortSignal,
  mapper: UpdateMapper,
  push: (outputs: ProviderOutput[]) => void,
): Promise<acp.StopReason> {
  const { policy } = workspace;
  const report = (name: string) => push(mapper.clientAction(name));
  const annotate = (name: string) => push(mapper.note(name));
  const commands = createCommandTracker(definition.streamsCommandOutput === true);
  const gated: DoWorkspace | null =
    policy && turn.approvals
      ? {
          policy,
          cwd: workspace.cwd,
          gate: turn.approvals,
          signal,
          report,
          annotate,
          mode: () => mapper.currentMode(),
        }
      : null;
  const doing = workspace.changing ? gated : null;
  const rails = gated ? createRailWatch({ roots: gated.policy.roots, cwd: gated.cwd }) : null;
  const secretRead = (label: string) => push([{ kind: 'secret_read', paths: [label] }]);
  const client = acp
    .client(CLIENT_INFO)
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      rails?.asked(ctx.params.toolCall.toolCallId);
      if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
      if (doing) return reviewPermission(ctx.params, ctx.requestId, doing);
      const plan = policy ? nativePlan(ctx.params, definition.id, mapper.shownPlan()) : [];
      if (gated && plan.length === 0 && runsCommand(ctx.params)) {
        return reviewPermission(ctx.params, ctx.requestId, gated);
      }
      const decision = declineInConversation(ctx.params, policy !== null);
      push(plan.length > 0 ? plan : mapper.clientAction(decision.note));
      return decision.response;
    })
    .onRequest(acp.methods.client.fs.writeTextFile, (ctx) =>
      doing
        ? writeWithApproval(ctx.params, doing)
        : refuseWrite(ctx.params, policy !== null, report),
    )
    .onNotification(AUTH_STATUS_METHOD, parseAuthStatus, ({ params }) => {
      if (params && definition.reportsModelAccess) push([{ kind: 'account', account: params }]);
    });
  if (policy) {
    client.onRequest(acp.methods.client.fs.readTextFile, (ctx) =>
      readTextFile(policy, ctx.params, report, secretRead),
    );
  }
  return client.connectWith(agent.stream, async (ctx) => {
    const init = await ctx.request<acp.InitializeResponse, acp.InitializeRequest>(
      acp.methods.agent.initialize,
      {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: clientCapabilities(policy !== null, doing !== null),
        clientInfo: CLIENT_INFO,
      },
    );
    assertProtocolVersion(definition.name, init);
    const support = promptSupport(init);
    if (!support.image && turn.attachments?.some((attachment) => attachment.kind === 'image')) {
      throw new ProviderError(
        `${definition.name} can't read images. Remove the image and try again.`,
      );
    }
    const spark = sparkAcpServer(workspace.spark, definition, init);
    const claude = withClaudeSpark(
      workspace.repo?.claude ?? null,
      turn.spark,
      policy !== null,
      spark ? workspace.spark : null,
    );
    const plan = newSessionRequest({
      agentName: definition.name,
      cwd: workspace.cwd,
      extraRoots: extraRoots(policy),
      meta: sessionMeta(definition, policy, doing !== null, claude, turn),
      init,
      mcpServers: spark ? [...workspace.mcpServers, spark] : workspace.mcpServers,
    });
    const opened = await openSession(
      ctx,
      plan.request,
      init,
      turn.session?.resume ?? null,
      workspace.replay,
      signal,
    );
    const { session, continued } = opened;
    try {
      if (turn.session) push([sessionOutput(plan.request, opened, turn.session.freshReason)]);
      const wish = modeWish(definition, turn, policy !== null, doing !== null);
      const applied = await applySessionSettings(
        ctx,
        session,
        definition,
        turn.settings,
        wish,
        continued,
      );
      push(settingsOutputs(applied, workspace.repo?.following ?? null));
      const sessionNotes = turn.session ? [sessionNote(opened, turn.session)] : [];
      const notes = [applied.using, ...sessionNotes, ...workspace.notes, ...plan.notes];
      for (const note of [...notes, ...applied.notes]) {
        if (note) push(mapper.note(note));
      }
      const { live } = applied;
      const ranModel = watchRanModel(definition.id, definition.name, live, mapper.note);
      const allowed = modeAllowed(definition, policy !== null, doing !== null);
      mapper.trackSettings(
        { ...applied.current, mode: applied.mode, values: applied.values },
        { allowed, name: (mode) => modeName(live.options(), mode) },
      );
      const stopRequests = turn.modeRequests?.subscribe(
        (mode) => void switchMode(live, mode, allowed, definition.name, push, mapper),
      );
      signal.addEventListener('abort', () => stopRequests?.(), { once: true });
      if (signal.aborted) return 'cancelled';
      const cancel = () =>
        void ctx
          .notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId })
          .catch(() => undefined);
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
      const promptOptions = {
        attachments: turn.attachments ?? [],
        support,
        projectRoots: policy?.roots.map((root) => root.path) ?? [],
        changesAllowed: doing !== null,
        commandsAllowed: gated !== null,
        toolsAvailable:
          plan.request.mcpServers.length > 0 ||
          (definition.repoStyle === 'codex' && workspace.spark !== null),
      };
      const sent = afterOpening(turn, continued);
      for (const step of contextSteps(sent.history, promptOptions)) push(mapper.note(step));
      const request = continued ? (sent.session?.followUp ?? turn.prompt) : turn.prompt;
      const slash = slashPrompt(
        request,
        definition.name,
        continued ? (turn.session?.resume?.commands ?? []) : null,
      );
      if (slash.note) push(mapper.note(slash.note));
      const text = promptText(sent, request, slash, continued);
      const blocks = continued
        ? followUpBlocks(text, promptOptions)
        : conversationBlocks(sent.history, text, promptOptions);
      const textOnly = { ...promptOptions, attachments: [] };
      const detachSteering = attachSteering(ctx, init, session.sessionId, turn.steering);
      let promptFailure = untilFailure(session.prompt(blocks));
      for (;;) {
        const message = await Promise.race([session.nextUpdate(), promptFailure]);
        if (message.kind === 'stop') {
          push(promptTokens(message.response.usage));
          mapper.stopped(message.response._meta);
          const next = await nextMessage(turn, message.stopReason, signal);
          if (next) {
            promptFailure = untilFailure(session.prompt(followUpBlocks(next, textOnly)));
            continue;
          }
          stopRequests?.();
          detachSteering();
          if (turn.session) await closeQuietly(ctx, init, session.sessionId);
          return message.stopReason;
        }
        if (message.update.sessionUpdate === 'config_option_update') {
          live.adopt(message.update.configOptions);
        }
        push(mapper.map(message.update));
        push(ranModel.see(message.update));
        push(commands.see(message.update));
        const observed = await rails?.observe(message.update);
        for (const flag of doing ? (observed?.rails ?? []) : []) {
          push([{ kind: 'rail_flag', flag }]);
        }
        if (observed?.secretReads.length) {
          push([{ kind: 'secret_read', paths: observed.secretReads }]);
        }
        const unsafe = mapper.unsafeModeChange();
        if (unsafe) {
          throw new ProviderError(
            `${definition.name} switched to ${modeName(live.options(), unsafe)} mode, so the run was stopped.`,
          );
        }
      }
    } finally {
      session.dispose();
    }
  });
}
