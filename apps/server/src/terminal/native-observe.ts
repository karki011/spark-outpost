import { createHash } from 'node:crypto';
import { z } from 'zod';
import { permissionFor } from '@spark-outpost/contracts';
import { sendUserMessage } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { nativeTerminalTarget } from '../persistence/native-terminal-settings.ts';
import { recordNativeStep } from '../persistence/native-terminal-steps.ts';
import {
  acceptNativeEvent,
  setNativeRun,
  setNativeTerminalState,
} from '../persistence/native-terminal-turns.ts';
import type { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { loadRunInput } from '../workflow/run-input.ts';
import {
  boundedNativeMode,
  nativeActivity,
  nativeTurnContext,
  observedNativeMode,
} from './native-context.ts';
import { NativeRuntimeError, type nativeControl } from './native-control.ts';
import { parseNativeHook, type NativeHookEvent } from './native-hooks.ts';
import type { WatchInterrupts } from './native-interrupts.ts';
import type { LiveSession } from './native-runtime-types.ts';

export const hookTokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
const digest = hookTokenDigest;
const envelopeSchema = z.strictObject({
  sessionId: z.uuid(),
  provider: z.enum(['claude', 'codex']),
  eventId: z.uuid(),
  payload: z.unknown(),
});

function interruptEventId(session: LiveSession, nativeTurnId: string): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([session.row.id, session.row.generation, nativeTurnId, 'interrupt']))
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

export function nativeObserver({
  db,
  waiters,
  tokens,
  enqueue,
  control: { syncScope, closeTurn, completed },
  watchInterrupts,
}: {
  db: Db;
  waiters: ApprovalWaiters;
  tokens: Map<string, LiveSession>;
  enqueue: <T>(session: LiveSession, work: () => Promise<T>) => Promise<T>;
  control: ReturnType<typeof nativeControl>;
  watchInterrupts: WatchInterrupts;
}) {
  const turn = async (session: LiveSession, event: NativeHookEvent, eventId: string) => {
    if ((session.seedPending || session.currentPromptEventId === eventId) && session.context)
      session.seedPending = false;
    else {
      if (session.context)
        await closeTurn(
          session,
          'outcome_unknown',
          'A new prompt arrived before completion was observed.',
        );
      session.currentPromptEventId = eventId;
      const target = await nativeTerminalTarget(
        db,
        session.row.conversation_id,
        session.row.provider,
      );
      const mode = session.mode ?? (session.row.provider === 'claude' ? 'plan' : 'read-only');
      const sent = await sendUserMessage(
        db,
        session.row.conversation_id,
        {
          id: eventId,
          content: event.prompt || 'Continue in the native terminal.',
        },
        { ...target, agentMode: mode, permission: permissionFor(session.row.provider, mode) },
      );
      if (
        !(await setNativeRun(db, {
          ...session.row,
          runId: sent.run.id,
          ...(event.nativeTurnId ? { nativeTurnId: event.nativeTurnId } : {}),
        }))
      )
        throw new NativeRuntimeError('This terminal turn is no longer current.', 409);
      session.context = await nativeTurnContext(
        db,
        session.row,
        await loadRunInput(db, sent.run.id),
        session.mode,
        waiters,
      );
    }
    session.currentPromptEventId = eventId;
    session.row.native_turn_id = event.nativeTurnId ?? null;
    await session.context!.mode(session.mode);
    syncScope(session);
  };
  const observe = async (session: LiveSession, event: NativeHookEvent, eventId: string) => {
    const retryCompletion = session.completedEvents.has(eventId);
    if (retryCompletion && session.completedEvents.get(eventId) !== session.currentPromptEventId)
      return;
    if (!retryCompletion && event.nativeTurnId && session.completedTurns.has(event.nativeTurnId))
      return;
    if (
      !retryCompletion &&
      event.kind !== 'prompt' &&
      event.kind !== 'session_start' &&
      event.kind !== 'session_end'
    ) {
      if (
        !session.context ||
        (event.nativeTurnId &&
          session.row.native_turn_id &&
          event.nativeTurnId !== session.row.native_turn_id)
      )
        return;
    }
    if (
      event.kind === 'prompt' &&
      event.nativeTurnId &&
      event.nativeTurnId === session.row.native_turn_id &&
      !session.seedPending &&
      session.currentPromptEventId !== eventId
    )
      return;
    if (event.permissionMode !== undefined) {
      const mode = boundedNativeMode(
        session.row.provider,
        session.ceiling,
        observedNativeMode(session.row.provider, event),
      );
      if (mode !== session.mode) {
        session.mode = mode;
        await session.context?.mode(mode);
      }
    }
    if (event.kind === 'prompt') await turn(session, event, eventId);
    if (event.tool && session.context && !retryCompletion)
      await recordNativeStep(db, session.context.input.identity.runId, event.tool);
    if (['stop', 'interrupt', 'error'].includes(event.kind)) completed(session, eventId);
    if (event.kind === 'stop') await closeTurn(session, 'succeeded');
    if (event.kind === 'interrupt')
      await closeTurn(session, 'cancelled', 'Interrupted in the native terminal.');
    if (event.kind === 'error')
      await closeTurn(session, 'failed', 'The native agent reported a turn failure.');
    if (event.kind === 'session_end') {
      if (session.context)
        await closeTurn(
          session,
          'outcome_unknown',
          event.reason
            ? `The native session ended (${event.reason}).`
            : 'The native session ended.',
        );
      session.nativeSessionEnded = true;
    }
    if (event.kind === 'session_start') session.nativeSessionEnded = false;
    const state = nativeActivity(event, session.context !== null);
    const nativeSessionId = event.nativeSessionId ?? session.row.native_session_id;
    const nativeTurnId = event.nativeTurnId ?? session.observedTurnId;
    if (
      state === session.row.state &&
      nativeSessionId === session.row.native_session_id &&
      nativeTurnId === session.observedTurnId
    )
      return;
    await setNativeTerminalState(db, {
      ...session.row,
      state,
      ...(event.nativeSessionId ? { nativeSessionId: event.nativeSessionId } : {}),
      ...(event.nativeTurnId ? { nativeTurnId: event.nativeTurnId } : {}),
    });
    session.row.state = state;
    session.row.native_session_id = nativeSessionId;
    session.observedTurnId = nativeTurnId;
  };
  const accept = async (session: LiveSession, event: NativeHookEvent, eventId: string) => {
    const seen = await db.query(
      'SELECT 1 FROM native_terminal_events WHERE session_id = $1 AND generation = $2 AND event_id = $3',
      [session.row.id, session.row.generation, eventId],
    );
    if (seen.rowCount) return;
    await observe(session, event, eventId);
    await acceptNativeEvent(db, { ...session.row, eventId });
  };
  const interrupted = (session: LiveSession, nativeTurnId: string) =>
    enqueue(session, async () => {
      if (tokens.get(session.hookKey) !== session) return;
      if (!session.context || session.row.native_turn_id !== nativeTurnId) return;
      await accept(
        session,
        { kind: 'interrupt', nativeTurnId },
        interruptEventId(session, nativeTurnId),
      );
    });
  const followInterrupts = (session: LiveSession, transcriptPath: string) => {
    session.interrupts = watchInterrupts(transcriptPath, async (nativeTurnId) => {
      await interrupted(session, nativeTurnId)
        .catch(() => interrupted(session, nativeTurnId))
        .catch(() => undefined);
    });
  };
  const hook = async (token: string, body: unknown) => {
    const session = tokens.get(digest(token));
    const parsed = envelopeSchema.safeParse(body);
    if (
      !session ||
      !parsed.success ||
      parsed.data.sessionId !== session.row.id ||
      parsed.data.provider !== session.row.provider
    )
      return false;
    const event = parseNativeHook(session.row.provider, parsed.data.payload);
    if (!event) return false;
    return enqueue(session, async () => {
      if (tokens.get(session.hookKey) !== session) return false;
      const anotherSession =
        event.nativeSessionId !== undefined &&
        session.row.native_session_id !== null &&
        event.nativeSessionId !== session.row.native_session_id;
      if (anotherSession && !(event.kind === 'session_start' && session.nativeSessionEnded))
        return false;
      await accept(session, event, parsed.data.eventId);
      if (event.transcriptPath && session.context && !session.interrupts)
        followInterrupts(session, event.transcriptPath);
      return true;
    });
  };
  return hook;
}
