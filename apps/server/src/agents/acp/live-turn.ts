import type * as acp from '@agentclientprotocol/sdk/unstable';
import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import type { AcpProviderOptions } from './acp-provider.ts';
import { changedParts } from './connection-key.ts';
import type { LiveConnection } from './live-connection.ts';
import type { LivePool } from './live-connections.ts';
import { betweenTurns, regrant, rebinds } from './live-tools.ts';
import type { SparkTools } from './spark-tools.ts';
import type { LaunchPlan } from './turn-launch.ts';

export interface Reused {
  connection: LiveConnection;
  tools: SparkTools | null;
}

const BUSY =
  "This chat's agent session is still busy with another run. Try again when it finishes.";

function reopenReason(live: LiveConnection, turn: ProviderTurn, plan: LaunchPlan): string[] | null {
  if (turn.live?.continuation) return null;
  const sessionId = live.opened()?.session.sessionId;
  if (turn.session?.resume?.sessionId !== sessionId) return ['session'];
  const changed = live.key ? changedParts(live.key, plan.key) : ['key'];
  return changed.length > 0 ? changed : null;
}

export async function liveReuse(
  options: AcpProviderOptions,
  pool: LivePool,
  turn: ProviderTurn,
  plan: LaunchPlan,
): Promise<Reused | null> {
  if (!turn.live) {
    const stored = turn.session?.resume?.sessionId;
    if (stored) await pool.closeSession(stored);
    return null;
  }
  const { conversationId } = turn.live;
  const live = pool.get(conversationId);
  if (!live?.opened()) return null;
  if (live.bound()) throw new ProviderError(BUSY);
  const changed = reopenReason(live, turn, plan);
  if (changed) {
    console.log(`Reopening the agent session of chat ${conversationId}: ${changed.join(', ')}`);
    await pool.close(conversationId);
    return null;
  }
  if (!live.tools) return { connection: live, tools: null };
  if (!rebinds(options.sparkTools) || !turn.sparkScope) {
    await pool.close(conversationId);
    return null;
  }
  const tools = await regrant(options.sparkTools, live.tools, turn.sparkScope);
  if ((tools.grant.offered ?? null) !== live.tools.offered) {
    console.log(`Reopening the agent session of chat ${conversationId}: spark tools`);
    await pool.close(conversationId);
    return null;
  }
  return { connection: live, tools };
}

const KEPT_STOPS = new Set<acp.StopReason>(['end_turn', 'max_tokens']);

export async function keepLive(
  options: AcpProviderOptions,
  pool: LivePool,
  turn: ProviderTurn,
  connection: LiveConnection,
  stopReason: acp.StopReason,
  signal: AbortSignal,
): Promise<boolean> {
  if (!turn.live || signal.aborted || !KEPT_STOPS.has(stopReason)) return false;
  if (connection.gone() || !connection.opened()) return false;
  const access = options.sparkTools;
  const scope = turn.sparkScope;
  if (connection.tools && (!rebinds(access) || !scope)) return false;
  pool.keep(turn.live.conversationId, connection);
  if (connection.tools && rebinds(access) && scope) {
    const idle = betweenTurns(scope, () => connection.whenBound());
    await regrant(access, connection.tools, idle);
  }
  pool.settled(turn.live.conversationId);
  return true;
}
