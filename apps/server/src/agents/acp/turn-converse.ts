import * as acp from '@agentclientprotocol/sdk';
import { ProviderError, type ProviderOutput, type ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { applySessionSettings, modeName, settingsOutputs } from './apply-settings.ts';
import { CLIENT_INFO, turnCapabilities } from './client-info.ts';
import { createCommandTracker } from './command-output.ts';
import {
  contextSteps,
  conversationBlocks,
  followUpBlocks,
  promptSupport,
  promptText,
} from './conversation-prompt.ts';
import { assertProtocolVersion } from './errors.ts';
import type { LiveConnection } from './live-connection.ts';
import { watchRanModel } from './ran-model.ts';
import { modeAllowed, modeWish, switchMode } from './session-modes.ts';
import {
  afterOpening,
  openSession,
  sessionNote,
  sessionOutput,
  type OpenedSession,
} from './session-open.ts';
import { newSessionRequest } from './session-request.ts';
import { extraRoots, sessionMeta } from './session-start.ts';
import { slashPrompt } from './slash-commands.ts';
import { withClaudeSpark } from './spark-instructions.ts';
import { sparkAcpServer, type SparkTools } from './spark-tools.ts';
import { attachSteering, steeringSupported } from './steering.ts';
import type { TurnMapper } from './subagent-updates.ts';
import { turnGates, turnHandlers, type TurnGates } from './turn-handlers.ts';
import type { Workspace } from './turn-launch.ts';
import { createRequestLog, runPrompts } from './turn-loop.ts';
import { createTurnTokens } from './turn-tokens.ts';
import { updateSink } from './update-sink.ts';

export interface TurnContext {
  connection: LiveConnection;
  definition: AgentDefinition;
  workspace: Workspace;
  turn: ProviderTurn;
  signal: AbortSignal;
  mapper: TurnMapper;
  push: (outputs: ProviderOutput[]) => void;
  tools: SparkTools | null;
}

interface SessionStart {
  init: acp.InitializeResponse;
  opened: OpenedSession;
  request: acp.NewSessionRequest;
  notes: string[];
}

async function startSession(context: TurnContext, gates: TurnGates): Promise<SessionStart> {
  const { connection, definition, workspace, turn, signal, tools } = context;
  const { ctx } = connection;
  const { policy } = workspace;
  const init = await ctx.request<acp.InitializeResponse, acp.InitializeRequest>(
    acp.methods.agent.initialize,
    {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: turnCapabilities(policy !== null, gates.doing !== null),
      clientInfo: CLIENT_INFO,
    },
  );
  assertProtocolVersion(definition.name, init);
  const spark = sparkAcpServer(tools, definition, init);
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
    meta: sessionMeta(definition, policy, gates.doing !== null, claude, turn),
    init,
    mcpServers: workspace.mcpServers,
    spark,
  });
  const opened = await openSession(
    ctx,
    plan.request,
    init,
    turn.session?.resume ?? null,
    workspace.replay,
    signal,
  );
  connection.attach({ init, session: opened.session, request: plan.request });
  return { init, opened, request: plan.request, notes: plan.notes };
}

function liveSession(connection: LiveConnection): SessionStart {
  const live = connection.opened()!;
  return {
    init: live.init,
    opened: { session: live.session, continued: true, freshReason: null, live: true },
    request: live.request,
    notes: [],
  };
}

export async function converse(context: TurnContext): Promise<acp.StopReason> {
  const { connection, definition, workspace, turn, signal, mapper, push } = context;
  const { policy } = workspace;
  const gates = turnGates(policy, workspace.cwd, workspace.changing, turn, signal, mapper, push);
  const requests = createRequestLog();
  const unbind = connection.bind(
    turnHandlers({
      definition,
      policy,
      gates,
      signal,
      mapper,
      requests,
      push,
      audit: workspace.replay.observer,
    }),
  );
  try {
    const started = connection.opened()
      ? liveSession(connection)
      : await startSession(context, gates);
    const { init, opened, request: newSession } = started;
    const { session, continued } = opened;
    const support = promptSupport(init);
    if (!support.image && turn.attachments?.some((attachment) => attachment.kind === 'image')) {
      throw new ProviderError(
        `${definition.name} can't read images. Remove the image and try again.`,
      );
    }
    if (turn.session) push([sessionOutput(newSession, opened, turn.session.freshReason)]);
    const wish = modeWish(definition, turn, policy !== null, gates.doing !== null);
    const applied = await applySessionSettings(
      connection.ctx,
      session,
      definition,
      turn.settings,
      wish,
      continued,
      connection.settings(),
    );
    connection.keepSettings(applied.live);
    push(settingsOutputs(applied, workspace.repo?.following ?? null));
    const sessionNotes = turn.session ? [sessionNote(opened, turn.session)] : [];
    const notes = [applied.using, ...sessionNotes, ...workspace.notes, ...started.notes];
    for (const note of [...notes, ...applied.notes]) {
      if (note) push(mapper.note(note));
    }
    const { live } = applied;
    const ranModel = watchRanModel(definition.id, definition.name, live, mapper.note);
    const allowed = modeAllowed(definition, policy !== null, gates.doing !== null);
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
      void connection.ctx
        .notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId })
        .catch(() => undefined);
    signal.addEventListener('abort', cancel, { once: true });
    const promptOptions = {
      attachments: turn.attachments ?? [],
      support,
      projectRoots: policy?.roots.map((root) => root.path) ?? [],
      changesAllowed: gates.doing !== null,
      commandsAllowed: gates.gated !== null,
      toolsAvailable:
        newSession.mcpServers.length > 0 ||
        sparkAcpServer(context.tools, definition, init) !== null ||
        (definition.repoStyle === 'codex' && workspace.spark !== null),
    };
    const blocks = turn.live?.continuation
      ? null
      : firstBlocks(turn, continued, promptOptions, mapper, push, definition.name);
    const stopReason = await runPrompts({
      session: {
        prompt: (sent) => session.prompt(sent),
        nextUpdate: () => connection.updates.next(),
      },
      blocks,
      followUp: { ...promptOptions, attachments: [] },
      turn,
      signal,
      mapper,
      tokens: createTurnTokens(definition.cli === 'claude'),
      requests,
      push,
      see: updateSink({
        agentName: definition.name,
        live,
        mapper,
        ranModel,
        commands: createCommandTracker(definition.streamsCommandOutput === true),
        rails: gates.rails,
        flagsRails: gates.doing !== null,
        push,
      }),
      background: connection.background,
      steers: steeringSupported(init),
      steer: (steering) => attachSteering(connection.ctx, init, session.sessionId, steering),
    });
    stopRequests?.();
    signal.removeEventListener('abort', cancel);
    return stopReason;
  } finally {
    unbind();
  }
}

type PromptOptions = Parameters<typeof conversationBlocks>[2];

function firstBlocks(
  turn: ProviderTurn,
  continued: boolean,
  promptOptions: PromptOptions,
  mapper: TurnMapper,
  push: (outputs: ProviderOutput[]) => void,
  agentName: string,
): acp.ContentBlock[] {
  const sent = afterOpening(turn, continued);
  for (const step of contextSteps(sent.history, promptOptions)) push(mapper.note(step));
  const request = continued ? (sent.session?.followUp ?? turn.prompt) : turn.prompt;
  const slash = slashPrompt(
    request,
    agentName,
    continued ? (turn.session?.resume?.commands ?? []) : null,
  );
  if (slash.note) push(mapper.note(slash.note));
  const text = promptText(sent, request, slash, continued);
  return continued
    ? followUpBlocks(text, promptOptions)
    : conversationBlocks(sent.history, text, promptOptions);
}
