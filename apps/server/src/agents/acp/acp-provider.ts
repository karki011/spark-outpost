import { setTimeout as delay } from 'node:timers/promises';
import type * as acp from '@agentclientprotocol/sdk/unstable';
import type { SecretStore } from '../../setup/secrets.ts';
import {
  ProviderError,
  type Provider,
  type ProviderOutput,
  type ProviderTurn,
} from '../../providers/provider.ts';
import type { AgentDefinition, AgentLaunch } from './agents.ts';
import { AgentExitedError, type AgentProcess } from './agent-process.ts';
import type { CliLocator } from './agent-cli.ts';
import { codexConfigFailed } from './codex-launch.ts';
import { openSparkTools, type SparkToolsAccess } from './spark-tools.ts';
import { Channel } from './channel.ts';
import { exitCause, type SignInCheck } from './exit-cause.ts';
import { failureError, namesCause } from './errors.ts';
import { asReported } from './reported-output.ts';
import { createTurnMapper, type TurnMapper } from './subagent-updates.ts';
import { createLivePool, type LivePool } from './live-connections.ts';
import type { LiveConnection } from './live-connection.ts';
import { liveTools } from './live-tools.ts';
import { discardScratch, planLaunch, spawnConnection, type LaunchPlan } from './turn-launch.ts';
import { converse } from './turn-converse.ts';
import { keepLive, liveReuse } from './live-turn.ts';

export const LOST_CYCLE =
  'The agent stopped before Spark could record what it did on its own. Send a message to pick up from there.';
export interface AcpProviderOptions {
  definition: AgentDefinition;
  launch?: AgentLaunch;
  locateCli?: CliLocator;
  env?: Record<string, string>;
  secrets?: Pick<SecretStore, 'get'>;
  cancelGraceMs?: number;
  sparkTools?: SparkToolsAccess;
  signedIn?: SignInCheck;
  liveIdleMs?: number;
  writeUpMs?: number;
}

const DEFAULT_CANCEL_GRACE_MS = 5_000;
const EXIT_WAIT_MS = 500;

export function createAcpProvider(options: AcpProviderOptions): Provider {
  const pool = createLivePool(options.liveIdleMs);
  return {
    name: options.definition.id,
    run: (turn) => runTurn(options, pool, turn),
    sessions: pool,
  };
}

async function* runTurn(options: AcpProviderOptions, pool: LivePool, turn: ProviderTurn) {
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
  const session = runSession(options, pool, turn, abort.signal, channel, false);
  try {
    yield* channel;
  } finally {
    turn.signal.removeEventListener('abort', forwardAbort);
    abort.abort();
    await session;
  }
}

function finishTurn(
  definition: AgentDefinition,
  turn: ProviderTurn,
  stopReason: acp.StopReason,
  mapper: TurnMapper,
  push: (outputs: ProviderOutput[]) => void,
): void {
  push(mapper.finish(stopReason === 'cancelled'));
  const continuation = turn.live?.continuation === true;
  const stalled = stopReason === 'end_turn' && !continuation ? mapper.stalled() : null;
  const failure = mapper.failure() ?? stalled;
  if (failure && stopReason !== 'cancelled') throw failureError(definition.name, failure);
  if (stopReason === 'end_turn' && !continuation && !mapper.repliedWithText()) {
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
}

async function connect(
  options: AcpProviderOptions,
  pool: LivePool,
  turn: ProviderTurn,
  plan: LaunchPlan,
  legacyPermissions: boolean,
  push: (outputs: ProviderOutput[]) => void,
  mapper: TurnMapper,
) {
  const reuse = await liveReuse(options, pool, turn, plan);
  if (reuse) {
    await discardScratch(plan);
    return reuse;
  }
  const tools = await openSparkTools(options.sparkTools, turn.sparkScope, plan.workspace.spark);
  try {
    const spawned = await spawnConnection(options, turn, plan, tools, legacyPermissions);
    spawned.connection.tools = tools ? liveTools(tools) : null;
    for (const note of spawned.notes) push(mapper.note(note));
    return { connection: spawned.connection, tools };
  } catch (error) {
    tools?.grant.revoke();
    throw error;
  }
}

async function runSession(
  options: AcpProviderOptions,
  pool: LivePool,
  turn: ProviderTurn,
  signal: AbortSignal,
  channel: Channel<ProviderOutput>,
  legacyPermissions: boolean,
): Promise<void> {
  const { definition } = options;
  const mapper = createTurnMapper(definition.name, definition.longContext === true);
  const push = (outputs: ProviderOutput[]) =>
    outputs.forEach((output) => channel.push(asReported(definition, output)));
  let connection: LiveConnection | null = null;
  let agent: AgentProcess | null = null;
  let kept = false;
  let finished = false;
  let retryWithoutProfiles = false;
  let graceTimer: NodeJS.Timeout | null = null;
  const onAbort = () => {
    agent?.stopping();
    graceTimer = setTimeout(
      () => void agent?.kill(),
      options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS,
    );
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (turn.live?.continuation && !pool.get(turn.live.conversationId)?.opened()) {
      channel.close(new ProviderError(LOST_CYCLE));
      return;
    }
    const plan = await planLaunch(options, turn, legacyPermissions);
    const connected = await connect(options, pool, turn, plan, legacyPermissions, push, mapper);
    connection = connected.connection;
    agent = connection.agent;
    const stopReason = await Promise.race([
      converse({
        connection,
        definition,
        workspace: plan.workspace,
        turn,
        signal,
        mapper,
        push,
        tools: connected.tools,
        ...(options.writeUpMs ? { writeUpMs: options.writeUpMs } : {}),
      }),
      connection.agent.exited,
    ]);
    finishTurn(definition, turn, stopReason, mapper, push);
    finished = true;
    kept = await keepLive(options, pool, turn, connection, stopReason, signal);
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
    if (connection && !kept) await endConnection(connection, turn, finished && !signal.aborted);
  }
  if (retryWithoutProfiles) await runSession(options, pool, turn, signal, channel, true);
}

async function endConnection(
  connection: LiveConnection,
  turn: ProviderTurn,
  settled: boolean,
): Promise<void> {
  if (turn.session === undefined) await connection.discard();
  else if (settled) await connection.close();
  else await connection.kill();
}

async function exitOr(agent: AgentProcess, error: unknown): Promise<unknown> {
  if (namesCause(error)) return error;
  const exit = await Promise.race([
    agent.exited.catch((reason: unknown) => reason),
    delay(EXIT_WAIT_MS).then(() => null),
  ]);
  return exit instanceof AgentExitedError ? exit : error;
}
