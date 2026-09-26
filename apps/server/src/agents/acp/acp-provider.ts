import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { childEnvironment } from '../../setup/environment.ts';
import {
  ProviderError,
  type Provider,
  type ProviderOutput,
  type ProviderTurn,
} from '../../providers/provider.ts';
import type { AgentDefinition, AgentLaunch } from './agents.ts';
import { AgentExitedError, startAgentProcess, type AgentProcess } from './agent-process.ts';
import { Channel } from './channel.ts';
import {
  contextSteps,
  conversationBlocks,
  followUpBlocks,
  type PromptSupport,
} from './conversation-prompt.ts';
import { failureError, toProviderError } from './errors.ts';
import { declineInConversation } from './permissions.ts';
import { applySessionSettings } from './apply-settings.ts';
import { CLIENT_INFO, clientCapabilities } from './client-info.ts';
import { readTextFile, refuseWrite } from './fs-handlers.ts';
import { reviewPermission, writeWithApproval, type DoWorkspace } from './do-handlers.ts';
import { projectPolicy, RootMissingError } from '../../projects/project-fs.ts';
import { primaryRoot, type PathPolicy } from '../../projects/path-policy.ts';
import { newSessionRequest } from './session-request.ts';
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
import { TITLE_REQUEST } from '../../titles/title-line.ts';

export interface AcpProviderOptions {
  definition: AgentDefinition;
  launch?: AgentLaunch;
  env?: Record<string, string>;
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
  if (turn.settings.method === 'api_key') {
    throw new ProviderError(
      `Chats through a ${options.definition.name} API key aren't supported yet. Reconnect ${options.definition.name} with the local CLI.`,
    );
  }
  const channel = new Channel<ProviderOutput>();
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
  const push = (outputs: ProviderOutput[]) => outputs.forEach((output) => channel.push(output));
  let agent: AgentProcess | null = null;
  let scratch: string | null = null;
  let graceTimer: NodeJS.Timeout | null = null;
  const onAbort = () => {
    graceTimer = setTimeout(() => agent?.kill(), options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const roots = turn.projectRoots ?? [];
    const browsing = roots.length > 0 && definition.readsProjectFolders;
    const policy = browsing ? await openProject(definition, roots) : null;
    const workdir = turn.session?.workdir ?? null;
    if (workdir) await mkdir(workdir, { recursive: true });
    else scratch = await mkdtemp(join(tmpdir(), 'spark-outpost-run-'));
    const home = workdir ?? scratch ?? tmpdir();
    const cwd = policy ? primaryRoot(policy) : home;
    const replay = replayFilter(turn.audit);
    agent = startAgentProcess(
      options.launch ?? definition.launch(),
      cwd,
      {
        ...(options.env ?? childEnvironment(process.env)),
        ...definition.conversationEnv?.(home, browsing),
      },
      replay.observer,
    );
    const notes = roots.length > 0 && !browsing ? [noFolderAccessNote(definition)] : [];
    const changing = policy !== null && turn.mode === 'do';
    if (changing) assertCanChange(definition, turn);
    const workspace = { cwd, policy, notes, changing, replay };
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
  planning: boolean,
) {
  if (!policy) return definition.conversationSessionMeta ?? null;
  if (changing) return definition.doSessionMeta?.(extraRoots(policy)) ?? null;
  const meta = planning ? definition.planSessionMeta : undefined;
  return (meta ?? definition.projectSessionMeta)?.(extraRoots(policy)) ?? null;
}

function assertCanChange(definition: AgentDefinition, turn: ProviderTurn): void {
  if (!definition.doSessionMeta) {
    throw new ProviderError(
      definition.doUnavailableReason ?? `${definition.name} can't make changes in Do mode yet.`,
    );
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
  const doing: DoWorkspace | null =
    workspace.changing && policy && turn.approvals
      ? { policy, cwd: workspace.cwd, gate: turn.approvals, signal, report }
      : null;
  const client = acp
    .client(CLIENT_INFO)
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
      if (doing) return reviewPermission(ctx.params, ctx.requestId, doing);
      const decision = declineInConversation(ctx.params, policy !== null);
      report(decision.note);
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
    if (init.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new ProviderError(
        `${definition.name} speaks ACP version ${init.protocolVersion}, but Spark Outpost needs ${acp.PROTOCOL_VERSION}.`,
      );
    }
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
      meta: sessionMeta(definition, policy, doing !== null, turn.planning === true),
      init,
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
      const applied = await applySessionSettings(ctx, session, definition, turn.settings);
      push([
        { kind: 'capabilities', report: applied.capabilities },
        { kind: 'session_settings', ...applied.current, mode: applied.mode },
      ]);
      const sessionNotes = turn.session ? [sessionNote(opened, turn.session.freshReason)] : [];
      const notes = [applied.using, ...sessionNotes, ...workspace.notes, ...plan.notes];
      for (const note of [...notes, ...applied.notes]) {
        if (note) push(mapper.note(note));
      }
      mapper.lockMode(applied.mode);
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
      const text = turn.askTitle ? `${request}\n\n${TITLE_REQUEST}` : request;
      const blocks = continued
        ? followUpBlocks(text, promptOptions)
        : conversationBlocks(history, text, promptOptions);
      const prompt = session.prompt(blocks);
      const promptFailure = prompt.then(() => new Promise<never>(() => undefined));
      for (;;) {
        const message = await Promise.race([session.nextUpdate(), promptFailure]);
        if (message.kind === 'stop') {
          push(promptTokens(message.response.usage));
          if (turn.session) await closeQuietly(ctx, init, session.sessionId);
          return message.stopReason;
        }
        push(mapper.map(message.update));
        const unsafe = mapper.unsafeModeChange();
        if (unsafe) {
          throw new ProviderError(
            `${definition.name} switched to ${unsafe} mode, so the run was stopped.`,
          );
        }
      }
    } finally {
      session.dispose();
    }
  });
}
