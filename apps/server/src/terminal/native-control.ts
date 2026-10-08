import type { Db } from '../persistence/db.ts';
import { finishNativeRun, setNativeTerminalState } from '../persistence/native-terminal-turns.ts';
import { SparkToolError } from '../spark-mcp/tool.ts';
import type { LiveSession } from './native-runtime-types.ts';

export function nativeControl(
  db: Db,
  live: Map<string, LiveSession>,
  tokens: Map<string, LiveSession>,
) {
  const syncScope = (session: LiveSession) => {
    const context = session.context;
    if (!context)
      throw new SparkToolError('Send a message in this terminal before using Spark tools.');
    context.check();
    Object.assign(session.scope, context.scope);
  };
  const completed = (session: LiveSession, eventId: string) => {
    session.completedEvents.set(eventId, session.currentPromptEventId);
    if (session.completedEvents.size > 64)
      session.completedEvents.delete(session.completedEvents.keys().next().value!);
  };
  const closeTurn = async (
    session: LiveSession,
    status: 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown',
    reason?: string,
  ) => {
    if (session.row.native_turn_id) {
      session.completedTurns.add(session.row.native_turn_id);
      if (session.completedTurns.size > 64)
        session.completedTurns.delete(session.completedTurns.values().next().value!);
    }
    await session.context?.close();
    await finishNativeRun(db, session.row, status, reason);
    session.context = null;
    session.scope.readOnly = true;
    session.scope.runId = null;
    delete session.scope.actions;
    delete session.scope.observations;
    session.scope.publish = null;
    session.row.native_turn_id = null;
  };
  const finish = async (
    session: LiveSession,
    state: 'exited' | 'error',
    cancelled: boolean,
    reason: string,
  ) => {
    if (live.get(session.row.conversation_id) !== session) return;
    live.delete(session.row.conversation_id);
    tokens.delete(session.hookKey);
    session.grant.revoke();
    try {
      await closeTurn(
        session,
        cancelled ? 'cancelled' : state === 'error' ? 'failed' : 'outcome_unknown',
        reason,
      );
      await setNativeTerminalState(db, { ...session.row, state, reason });
    } finally {
      await session.launch.dispose();
    }
  };
  return { syncScope, closeTurn, finish, completed };
}
