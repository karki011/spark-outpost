import { randomBytes, randomUUID } from 'node:crypto';
import type {
  NativeTerminalLaunchRequest,
  NativeTerminalLaunchResponse,
  NativeTerminalProvider,
} from '@spark-outpost/contracts';
import { loginShellLocator } from '../agents/acp/agent-cli.ts';
import {
  nativeTerminalMode,
  nativeTerminalRow,
  nativeTerminalView,
} from '../persistence/native-terminals.ts';
import {
  failNativeLaunchRun,
  finishNativeRun,
  recoverNativeTerminals,
  reserveNativeTerminalLaunch,
  setNativeRun,
  setNativeTerminalState,
  NativeTerminalConflictError,
} from '../persistence/native-terminal-turns.ts';
import type { SparkScope } from '../spark-mcp/deps.ts';
import type { SparkGrant } from '../spark-mcp/host.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { stopRun as cancelRun } from '../workflow/stop-run.ts';
import { nativeControl, nativeLaunchError, NativeRuntimeError } from './native-control.ts';
import { nativeObserver, hookTokenDigest as digest } from './native-observe.ts';
import { attachNativeSession } from './native-attach.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import { nativeHookHost } from './native-hook-host.ts';
import { nativeTurnContext } from './native-context.ts';
import { isNativeSessionId } from './native-hooks.ts';
import { watchClaudeInterrupts } from './native-interrupts.ts';
import { prepareNativeLaunch, type NativeLaunch } from './native-launch.ts';
import { prepareNativeSession } from './native-prepare.ts';

export type { NativeRuntime, NativeRuntimeDeps } from './native-runtime-types.ts';
import type { NativeRuntime, NativeRuntimeDeps, LiveSession } from './native-runtime-types.ts';

export async function createNativeRuntime(deps: NativeRuntimeDeps): Promise<NativeRuntime> {
  const live = new Map<string, LiveSession>();
  const tokens = new Map<string, LiveSession>();
  const launches = new Map<string, { key: string; work: Promise<NativeTerminalLaunchResponse> }>();
  const stoppedLaunches = new Set<string>();
  const waiters = deps.approvalWaiters ?? new ApprovalWaiters();
  let disposed = false;
  const enqueue = <T>(session: LiveSession, work: () => Promise<T>): Promise<T> => {
    const next = session.chain.then(work);
    session.chain = next.catch(() => undefined);
    return next;
  };
  const owned = async (conversationId: string) => {
    const { rows } = await deps.db.query<{
      session_type: string;
      terminal_provider: NativeTerminalProvider | null;
    }>(
      'SELECT session_type, terminal_provider FROM conversations WHERE id = $1 AND workspace_id = $2',
      [conversationId, deps.workspaceId],
    );
    if (!rows[0]) throw new NativeRuntimeError('Conversation not found.', 404);
    return rows[0];
  };
  const control = nativeControl(deps.db, live, tokens);
  const { syncScope, finish } = control;
  const hook = nativeObserver({
    db: deps.db,
    waiters,
    tokens,
    enqueue,
    control,
    watchInterrupts: deps.watchInterrupts ?? watchClaudeInterrupts,
  });
  const host = await nativeHookHost((token) => tokens.has(digest(token)), hook);
  const launchOnce = async (
    conversationId: string,
    request: NativeTerminalLaunchRequest,
  ): Promise<NativeTerminalLaunchResponse> => {
    if (disposed) throw new NativeRuntimeError('The terminal host is stopping.', 503);
    const conversation = await owned(conversationId);
    if (conversation.session_type !== 'terminal')
      throw new NativeRuntimeError('Open a Terminal session first.');
    if (request.provider && request.provider !== conversation.terminal_provider)
      throw new NativeTerminalConflictError('Start a new Terminal session to use another agent.');
    const current = live.get(conversationId);
    if (current) {
      if (request.prompt || request.resume)
        throw new NativeTerminalConflictError('Use the running terminal to send another message.');
      const connection = deps.terminals.reattach(current.row.id);
      if (!connection)
        throw new NativeTerminalConflictError('This terminal is closing. Try again in a moment.');
      return {
        session: nativeTerminalView((await nativeTerminalRow(deps.db, conversationId))!),
        connection: { ...connection, ...current.folder },
      };
    }
    const previous = await nativeTerminalRow(deps.db, conversationId);
    const provider = request.provider ?? previous?.provider ?? conversation.terminal_provider;
    if (!provider) throw new NativeRuntimeError('Choose Claude Code or Codex for this terminal.');
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
    const command = await (deps.locateCli ?? loginShellLocator(process.env.SHELL || '/bin/zsh'))(
      provider,
    );
    if (!command)
      throw new NativeRuntimeError(
        `Install ${provider === 'claude' ? 'Claude Code' : 'Codex'} before opening its terminal.`,
      );
    const prepared = await prepareNativeSession(deps, conversationId, provider, request, previous);
    if (disposed || stoppedLaunches.has(conversationId)) {
      if (prepared.runId) await cancelRun(deps.db, prepared.runId);
      throw new NativeRuntimeError('This terminal launch was stopped.', 409);
    }
    const row = await reserveNativeTerminalLaunch(deps.db, {
      id: previous?.id ?? randomUUID(),
      conversationId,
      provider,
      cwd: prepared.folder.cwd,
      label: prepared.folder.label,
      runId: prepared.runId,
      messageId: prepared.runId
        ? prepared.input.identity.runId === prepared.runId
          ? (
              await deps.db.query<{ user_message_id: string }>(
                'SELECT user_message_id FROM runs WHERE id = $1',
                [prepared.runId],
              )
            ).rows[0]!.user_message_id
          : null
        : null,
      resume: request.resume,
      observation: 'unsupported',
      reason: null,
    }).catch(async (error: unknown) => {
      const failure = nativeLaunchError(error);
      if (prepared.runId) await failNativeLaunchRun(deps.db, prepared.runId, failure.message);
      throw failure;
    });
    const token = randomBytes(32).toString('base64url');
    const scope: SparkScope = {
      workspaceId: deps.workspaceId,
      conversationId,
      runId: prepared.runId,
      readOnly: false,
    };
    let grant: SparkGrant | null = null;
    let launch: NativeLaunch | null = null;
    let session: LiveSession | null = null;
    try {
      grant = await deps.mcp.grant(scope);
      launch = await (deps.prepareLaunch ?? prepareNativeLaunch)({
        provider,
        sessionId: row.id,
        cwd: row.cwd,
        prompt: prepared.prompt,
        instructions: prepared.instructions,
        agentMode: prepared.input.agentMode ?? (provider === 'claude' ? 'auto' : 'agent'),
        ...(request.resume && row.native_session_id
          ? { resumeSessionId: row.native_session_id }
          : {}),
        attachments: prepared.input.attachments,
        dataDir: deps.dataDir,
        channel: deps.channel,
        command,
        mcp: grant,
        hooks: { url: host.url, token },
      });
      row.observation = launch.observation;
      await deps.db.query(
        'UPDATE native_terminal_sessions SET observation = $3 WHERE id = $1 AND generation = $2',
        [row.id, row.generation, launch.observation],
      );
      const context = prepared.runId
        ? await nativeTurnContext(deps.db, row, prepared.input, null, waiters)
        : null;
      session = {
        row,
        folder: prepared.folder,
        scope,
        grant,
        launch,
        context,
        mode: null,
        ceiling: prepared.input.agentMode ?? (provider === 'claude' ? 'auto' : 'agent'),
        seedPending: prepared.runId !== null,
        nativeSessionEnded: false,
        observedTurnId: null,
        chain: Promise.resolve(),
        hookKey: digest(token),
        completedTurns: new Set(),
        currentPromptEventId: null,
        completedEvents: new Map(),
        interrupts: null,
      };
      const running = session;
      scope.beforeToolCall = async () => {
        await running.chain;
        syncScope(running);
      };
      if (prepared.runId) {
        if (!(await setNativeRun(deps.db, { ...row, runId: prepared.runId })))
          throw new NativeRuntimeError('This terminal turn was cancelled before launch.', 409);
        await context!.mode(null);
      }
      live.set(conversationId, session);
      if (launch.observation === 'hooks') tokens.set(session.hookKey, session);
      const reason =
        launch.observation === 'unsupported'
          ? 'Lifecycle hook compatibility could not be verified. Native terminal permissions still apply.'
          : provider === 'codex'
            ? 'Waiting for trusted lifecycle events. Review Spark hooks with /hooks in Codex.'
            : 'Waiting for native lifecycle events.';
      await setNativeTerminalState(deps.db, { ...row, state: 'unknown', reason });
      const cancelled = prepared.runId ? await isCancelRequested(deps.db, prepared.runId) : false;
      if (
        disposed ||
        stoppedLaunches.has(conversationId) ||
        live.get(conversationId) !== running ||
        cancelled
      )
        throw new NativeRuntimeError('This terminal launch was stopped.', 409);
      const connection = deps.terminals.createAgent({
        id: row.id,
        conversationId,
        cwd: row.cwd,
        label: row.label,
        command: launch.command,
        args: launch.args,
        env: launch.env,
        onExit: (exit) => {
          void enqueue(running, () =>
            finish(
              running,
              exit.exitCode === 0 ? 'exited' : 'error',
              false,
              `Native agent exited (${exit.exitCode}).`,
            ),
          ).catch(() => undefined);
        },
      });
      return {
        session: nativeTerminalView((await nativeTerminalRow(deps.db, conversationId))!),
        connection: { ...connection, ...prepared.folder },
      };
    } catch (error) {
      deps.terminals.kill(row.id);
      if (session) {
        live.delete(conversationId);
        tokens.delete(session.hookKey);
        session.interrupts?.close();
        await session.context?.close();
      }
      grant?.revoke();
      await launch?.dispose();
      const cancelled =
        disposed ||
        stoppedLaunches.has(conversationId) ||
        (prepared.runId !== null && (await isCancelRequested(deps.db, prepared.runId)));
      const failure = nativeLaunchError(error);
      const reason = cancelled ? 'Stopped by the user.' : failure.message;
      await finishNativeRun(deps.db, row, cancelled ? 'cancelled' : 'failed', reason);
      await setNativeTerminalState(deps.db, {
        ...row,
        state: cancelled ? 'exited' : 'error',
        reason,
      });
      throw failure;
    }
  };
  const stop = async (conversationId: string) => {
    stoppedLaunches.add(conversationId);
    await owned(conversationId);
    const queued = await deps.db.query<{ id: string }>(
      `SELECT r.id FROM runs r JOIN conversations c ON c.id = r.conversation_id
       WHERE c.id = $1 AND c.session_type = 'terminal' AND r.status IN ('queued', 'running', 'awaiting_approval')
         AND NOT EXISTS (SELECT 1 FROM jobs WHERE run_id = r.id)`,
      [conversationId],
    );
    await Promise.all(queued.rows.map((row) => cancelRun(deps.db, row.id)));
    const session = live.get(conversationId);
    if (session) {
      session.context?.controller.abort();
      session.grant.revoke();
      try {
        await enqueue(session, () => finish(session, 'exited', true, 'Stopped by the user.'));
      } finally {
        deps.terminals.kill(session.row.id);
      }
    }
    await launches.get(conversationId)?.work.catch(() => undefined);
  };
  const stopAll = async () => {
    await Promise.all([...new Set([...launches.keys(), ...live.keys()])].map(stop));
  };
  return {
    port: host.port,
    async get(conversationId) {
      await owned(conversationId);
      const row = await nativeTerminalRow(deps.db, conversationId);
      return row ? nativeTerminalView(row, await nativeTerminalMode(deps.db, row)) : null;
    },
    launch(conversationId, request) {
      const key = JSON.stringify(request);
      const current = launches.get(conversationId);
      if (current) {
        const attach =
          !request.prompt && !request.resume && !request.messageId && !request.provider;
        if (current.key !== key && !attach)
          return Promise.reject(
            new NativeTerminalConflictError('This terminal is already starting.'),
          );
        return current.work;
      }
      stoppedLaunches.delete(conversationId);
      const work = launchOnce(conversationId, request).finally(() =>
        launches.delete(conversationId),
      );
      launches.set(conversationId, { key, work });
      return work;
    },
    hook,
    stop,
    stopAll,
    async stopRun(runId) {
      const session = [...live.values()].find(
        (item) => item.context?.input.identity.runId === runId,
      );
      if (!session) return false;
      await stop(session.row.conversation_id);
      return true;
    },
    async stopSession(id) {
      const session = [...live.values()].find((item) => item.row.id === id);
      if (!session) return false;
      await stop(session.row.conversation_id);
      return true;
    },
    async attachSession(id) {
      return attachNativeSession(deps.db, deps.workspaceId, deps.terminals, live, launches, id);
    },
    async recover() {
      if (live.size) throw new NativeRuntimeError('Recovery requires a stopped terminal host.');
      await recoverNativeTerminals(deps.db);
    },
    async dispose() {
      disposed = true;
      try {
        await stopAll();
      } finally {
        await host.close();
      }
    },
  };
}
