import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type { TokenUsage } from '@spark-outpost/contracts';
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
import { auditCodexInstructions, withClaudeSpark, withCodexSpark } from './spark-instructions.ts';
import { Channel } from './channel.ts';
import {
  contextSteps,
  conversationBlocks,
  followUpBlocks,
  type PromptSupport,
} from './conversation-prompt.ts';
import { assertProtocolVersion, failureError, toProviderError } from './errors.ts';
import { declineInConversation, nativePlan } from './permissions.ts';
import { applySessionSettings, modeName } from './apply-settings.ts';
import { modeAllowed, modeWish, switchMode } from './session-modes.ts';
import { offeredCapabilities } from './capabilities.ts';
import { CLIENT_INFO, clientCapabilities } from './client-info.ts';
import { readTextFile, refuseWrite } from './fs-handlers.ts';
import { reviewPermission, writeWithApproval, type DoWorkspace } from './do-handlers.ts';
import { projectPolicy, RootMissingError } from '../../projects/project-fs.ts';
import { primaryRoot, type PathPolicy } from '../../projects/path-policy.ts';
import { newSessionRequest } from './session-request.ts';
import { attachSteering } from './steering.ts';
import {
  namedMcpServers,
  prepareRepoSession,
  type ClaudeRepoOptions,
  type NamedMcpServer,
  type RepoSession,
} from './repo-session.ts';
import { codexUserMcpNames } from './codex-mcp.ts';
import { resolveUserMcp } from '../../mcp/launch.ts';
import { childEnvironment } from '../../setup/environment.ts';
import {
  FRESH_REASONS,
  closeQuietly,
  openSession,
  replayFilter,
  type OpenedSession,
  type ReplayFilter,
} from './session-open.ts';
import { createUpdateMapper, type UpdateMapper } from './session-updates.ts';
import { promptTokens } from './prompt-usage.ts';
import { slashPrompt, type SlashPrompt } from './slash-commands.ts';
import { TITLE_REQUEST } from '../../titles/title-line.ts';

export interface AcpProviderOptions {
  definition: AgentDefinition;
  launch?: AgentLaunch;
  env?: Record<string, string>;
  secrets?: Pick<SecretStore, 'get'>;
  cancelGraceMs?: number;
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
  const session = runSession(options, turn, abort.signal, channel);
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
): Promise<void> {
  const { definition } = options;
  const mapper = createUpdateMapper(definition.name);
  const push = (outputs: ProviderOutput[]) =>
    outputs.forEach((output) => channel.push(asReported(definition, output)));
  let agent: AgentProcess | null = null;
  let scratch: string | null = null;
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
    const reserved =
      definition.repoStyle === 'codex'
        ? await codexUserMcpNames(options.env ?? childEnvironment(process.env))
        : [];
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
    const codex = withCodexSpark(repo?.codex ?? null, turn.spark);
    if (definition.repoStyle === 'codex') auditCodexInstructions(turn.audit, codex);
    const builder = turn.builder === true;
    const env = await agentEnvironment(options, home, browsing, codex, builder, turn.env);
    agent = startAgentProcess(options.launch ?? definition.launch(), cwd, env, replay.observer);
    const notes = roots.length > 0 && !browsing ? [noFolderAccessNote(definition)] : [];
    if (roots.length < linked.length) notes.push(primaryOnlyNote(definition, roots[0]!));
    const changing = policy !== null && turn.mode === 'do';
    if (changing) assertCanChange(definition, turn);
    const workspace = { cwd, policy, notes, changing, replay, repo, mcpServers };
    const stopReason = await Promise.race([
      converse(agent, definition, workspace, turn, signal, mapper, push),
      agent.exited,
    ]);
    push(mapper.finish(stopReason === 'cancelled'));
    const failure = mapper.failure();
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
    push(mapper.finish(true));
    if (signal.aborted) channel.close();
    else {
      const cause = agent ? await exitOr(agent, error) : error;
      channel.close(toProviderError(definition.name, cause, agent?.stderrTail() ?? ''));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (graceTimer) clearTimeout(graceTimer);
    agent?.kill();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

function asReported(definition: AgentDefinition, output: ProviderOutput): ProviderOutput {
  if (output.kind === 'usage') {
    const readings = definition.usageReadings ? { readings: definition.usageReadings } : {};
    return { ...output, ...readings, ...(definition.estimatesCost ? { costUsd: null } : {}) };
  }
  if (output.kind === 'tokens' && definition.inputExcludesCache) {
    return { ...output, tokens: withCachedInput(output.tokens) };
  }
  if (output.kind === 'capabilities') {
    return { ...output, report: offeredCapabilities(output.report, definition.offers) };
  }
  if (output.kind === 'session_settings' && definition.usedModel) {
    return { ...output, model: definition.usedModel(output.model) };
  }
  return output;
}

function withCachedInput(tokens: TokenUsage): TokenUsage {
  return { ...tokens, input: tokens.input + (tokens.cachedRead ?? 0) };
}

async function exitOr(agent: AgentProcess, error: unknown): Promise<unknown> {
  if (error instanceof ProviderError) return error;
  const exit = await Promise.race([
    agent.exited.catch((reason: unknown) => reason),
    delay(EXIT_WAIT_MS).then(() => null),
  ]);
  return exit instanceof AgentExitedError ? exit : error;
}

async function openProject(
  definition: AgentDefinition,
  roots: readonly string[],
): Promise<PathPolicy> {
  try {
    return await projectPolicy(roots);
  } catch (error) {
    const root = error instanceof RootMissingError ? error.root : roots.join(', ');
    throw new ProviderError(
      `${definition.name} can't open the project folder ${root}. Check that it still exists, or link the project again.`,
    );
  }
}

function extraRoots(policy: PathPolicy | null): string[] {
  return policy ? policy.roots.slice(1).map((root) => root.path) : [];
}

function sessionMeta(
  definition: AgentDefinition,
  policy: PathPolicy | null,
  changing: boolean,
  repo: ClaudeRepoOptions | null,
  { builder, coordinated, planning }: Pick<ProviderTurn, 'builder' | 'coordinated' | 'planning'>,
) {
  if (!policy) return definition.conversationSessionMeta?.(repo) ?? null;
  const roots = extraRoots(policy);
  if (changing) return definition.doSessionMeta?.(roots, repo, builder, coordinated) ?? null;
  return definition.projectSessionMeta?.(roots, repo, planning === true) ?? null;
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
}

export function noFolderAccessNote(definition: AgentDefinition): string {
  return `${definition.name} can't browse project folders; attach files with @ instead`;
}

function sessionOutput(
  request: acp.NewSessionRequest,
  opened: OpenedSession,
  planned: string | null,
): ProviderOutput {
  return {
    kind: 'session',
    sessionId: opened.session.sessionId,
    cwd: request.cwd,
    additionalDirectories: [...(request.additionalDirectories ?? [])],
    continued: opened.continued,
    freshReason: opened.continued ? null : (opened.freshReason ?? planned),
  };
}

function sessionNote(opened: OpenedSession, planned: string | null): string | null {
  if (opened.continued) return 'Continued session';
  if (opened.freshReason === FRESH_REASONS.unsupported) return null;
  const reason = opened.freshReason ?? planned;
  return reason ? `Fresh session (${reason})` : null;
}

function promptSupport(init: acp.InitializeResponse): PromptSupport {
  const capabilities = init.agentCapabilities?.promptCapabilities;
  return {
    image: capabilities?.image === true,
    embeddedContext: capabilities?.embeddedContext === true,
  };
}

function promptText(
  turn: ProviderTurn,
  request: string,
  slash: SlashPrompt,
  continued: boolean,
): string {
  const asked = continued ? slash.text : request;
  const primed =
    !continued && turn.preamble && slash.kind !== 'command'
      ? `${turn.preamble}\n\n${asked}`
      : asked;
  return turn.askTitle && slash.kind !== 'command' ? `${primed}\n\n${TITLE_REQUEST}` : primed;
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
  const doing: DoWorkspace | null =
    workspace.changing && policy && turn.approvals
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
  const client = acp
    .client(CLIENT_INFO)
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
      if (doing) return reviewPermission(ctx.params, ctx.requestId, doing);
      const decision = declineInConversation(ctx.params, policy !== null);
      const plan = policy ? nativePlan(ctx.params, definition.id) : [];
      push(plan.length > 0 ? plan : mapper.clientAction(decision.note));
      return decision.response;
    })
    .onRequest(acp.methods.client.fs.writeTextFile, (ctx) =>
      doing
        ? writeWithApproval(ctx.params, doing)
        : refuseWrite(ctx.params, policy !== null, report),
    );
  if (policy) {
    client.onRequest(acp.methods.client.fs.readTextFile, (ctx) =>
      readTextFile(policy, ctx.params, report),
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
    const plan = newSessionRequest({
      agentName: definition.name,
      cwd: workspace.cwd,
      extraRoots: extraRoots(policy),
      meta: sessionMeta(
        definition,
        policy,
        doing !== null,
        withClaudeSpark(workspace.repo?.claude ?? null, turn.spark, policy !== null),
        turn,
      ),
      init,
      mcpServers: workspace.mcpServers,
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
      const applied = await applySessionSettings(ctx, session, definition, turn.settings, wish);
      push([
        { kind: 'capabilities', report: applied.capabilities },
        {
          kind: 'session_settings',
          ...applied.current,
          mode: applied.mode,
          options: applied.values,
        },
        ...(workspace.repo
          ? [{ kind: 'instructions' as const, files: workspace.repo.following }]
          : []),
      ]);
      const sessionNotes = turn.session ? [sessionNote(opened, turn.session.freshReason)] : [];
      const notes = [applied.using, ...sessionNotes, ...workspace.notes, ...plan.notes];
      for (const note of [...notes, ...applied.notes]) {
        if (note) push(mapper.note(note));
      }
      const { live } = applied;
      const allowed = modeAllowed(definition, turn, policy !== null, doing !== null);
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
      };
      const history = continued ? [] : turn.history;
      for (const step of contextSteps(history, promptOptions)) push(mapper.note(step));
      const request = continued ? (turn.session?.followUp ?? turn.prompt) : turn.prompt;
      const slash = slashPrompt(
        request,
        definition.name,
        continued ? (turn.session?.resume?.commands ?? []) : null,
      );
      if (slash.note) push(mapper.note(slash.note));
      const text = promptText(turn, request, slash, continued);
      const blocks = continued
        ? followUpBlocks(text, promptOptions)
        : conversationBlocks(history, text, promptOptions);
      const detachSteering = attachSteering(ctx, init, session.sessionId, turn.steering);
      const prompt = session.prompt(blocks);
      const promptFailure = prompt.then(() => new Promise<never>(() => undefined));
      for (;;) {
        const message = await Promise.race([session.nextUpdate(), promptFailure]);
        if (message.kind === 'stop') {
          stopRequests?.();
          detachSteering();
          push(promptTokens(message.response.usage));
          if (turn.session) await closeQuietly(ctx, init, session.sessionId);
          return message.stopReason;
        }
        if (message.update.sessionUpdate === 'config_option_update') {
          live.adopt(message.update.configOptions);
        }
        push(mapper.map(message.update));
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
