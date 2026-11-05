import type {
  NativeTerminalLaunchRequest,
  NativeTerminalProvider,
  TrackedTerminalProvider,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { NativeTerminalRow } from '../persistence/native-terminals.ts';
import { NativeTerminalConflictError } from '../persistence/native-terminal-turns.ts';
import { NativeRuntimeError } from './native-control.ts';
import { isNativeSessionId } from './native-hooks.ts';

export function assertTerminalChat(
  conversation: { session_type: string; terminal_provider: NativeTerminalProvider | null },
  request: NativeTerminalLaunchRequest,
): void {
  if (conversation.session_type !== 'terminal')
    throw new NativeRuntimeError('Open a Terminal session first.');
  if (request.provider && request.provider !== conversation.terminal_provider)
    throw new NativeTerminalConflictError('Start a new Terminal session to use another agent.');
}

export function providerToLaunch(
  chosen: NativeTerminalProvider | null,
  request: NativeTerminalLaunchRequest,
  previous: NativeTerminalRow | null,
): NativeTerminalProvider {
  const provider = request.provider ?? previous?.provider ?? chosen;
  if (!provider) throw new NativeRuntimeError('Choose an agent for this terminal.');
  if (previous && !['exited', 'error', 'interrupted'].includes(previous.state))
    throw new NativeTerminalConflictError('That terminal agent is already running.');
  if (previous?.native_session_id && !request.resume)
    throw new NativeTerminalConflictError(
      'Resume the ended terminal explicitly, or start a new Terminal session.',
    );
  if (
    request.resume &&
    (!isNativeSessionId(previous?.native_session_id) || previous?.provider !== provider)
  )
    throw new NativeTerminalConflictError(
      'This terminal has no native session to resume. Start a new Terminal session.',
    );
  return provider;
}

export function ownedTerminalChat(db: Queryable, workspaceId: string) {
  return async (conversationId: string) => {
    const { rows } = await db.query<{
      session_type: string;
      terminal_provider: NativeTerminalProvider | null;
    }>(
      'SELECT session_type, terminal_provider FROM conversations WHERE id = $1 AND workspace_id = $2',
      [conversationId, workspaceId],
    );
    if (!rows[0]) throw new NativeRuntimeError('Conversation not found.', 404);
    return rows[0];
  };
}

export async function launchMessageId(
  db: Queryable,
  prepared: { runId: string | null; input: { identity: { runId: string } } },
): Promise<string | null> {
  if (!prepared.runId || prepared.input.identity.runId !== prepared.runId) return null;
  const { rows } = await db.query<{ user_message_id: string }>(
    'SELECT user_message_id FROM runs WHERE id = $1',
    [prepared.runId],
  );
  return rows[0]!.user_message_id;
}

export function launchReason(
  observation: 'hooks' | 'unsupported',
  provider: TrackedTerminalProvider,
): string {
  if (observation === 'unsupported')
    return 'Lifecycle hook compatibility could not be verified. Native terminal permissions still apply.';
  if (provider === 'codex')
    return 'Waiting for trusted lifecycle events. Review Spark hooks with /hooks in Codex.';
  return 'Waiting for native lifecycle events.';
}
