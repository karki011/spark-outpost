import type { Db } from '../persistence/db.ts';
import {
  finishNativeRun,
  retractNativeRun,
  setNativeTerminalState,
} from '../persistence/native-terminal-turns.ts';
import { SparkToolError } from '../spark-mcp/tool.ts';
import { saveModUsage } from './mod-telemetry.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { NativeUsage } from './native-usage.ts';

export class NativeRuntimeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function nativeLaunchError(error: unknown): Error {
  if (error instanceof Error && error.constructor !== Error) return error;
  return new NativeRuntimeError('The terminal could not start. Try again.', 500, { cause: error });
}

export function nativeControl(
  db: Db,
  live: Map<string, LiveSession>,
  tokens: Map<string, LiveSession>,
  usage: NativeUsage,
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
  const clearTurn = (session: LiveSession) => {
    session.context = null;
    session.scope.readOnly = true;
    session.scope.runId = null;
    delete session.scope.actions;
    delete session.scope.observations;
    session.scope.publish = null;
    session.row.native_turn_id = null;
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
    await usage.settle(session);
    await session.context?.close();
    await finishNativeRun(db, session.row, status, reason);
    clearTurn(session);
  };
  const retractTurn = async (session: LiveSession, promptId: string) => {
    const moved = usage.moveToOwner(session, promptId);
    if (!moved) return;
    const open = session.context?.input.identity.runId === moved.runId;
    if (open) {
      session.completedTurns.add(promptId);
      await session.context?.close();
    }
    const removed = await retractNativeRun(db, session.row, moved.runId, moved.ownerRunId).catch(
      () => false,
    );
    if (open && !removed) await finishNativeRun(db, session.row, 'succeeded');
    if (open) clearTurn(session);
    await usage.saveNow(session);
    await saveModUsage(db, moved.ownerRunId).catch(() => undefined);
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
  return { syncScope, closeTurn, finish, completed, retractTurn };
}
