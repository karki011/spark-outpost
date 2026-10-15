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
import { nativeTerminalUsage, STOPPED_BY_USER } from '../persistence/native-terminal-usage.ts';
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
import { sparkGrantKey, type SparkGrant } from '../spark-mcp/host.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { stopRun as cancelRun } from '../workflow/stop-run.ts';
import { nativeControl, nativeLaunchError, NativeRuntimeError } from './native-control.ts';
import { nativeObserver, hookTokenDigest as digest } from './native-observe.ts';
import { attachNativeSession } from './native-attach.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import { nativeHookHost } from './native-hook-host.ts';
import { nativeTurnContext } from './native-context.ts';
import { watchTranscript } from './native-tail.ts';
import { nativeUsage } from './native-usage.ts';
import { saveSessionImage } from './native-images.ts';
import { prepareNativeLaunch, type NativeLaunch } from './native-launch.ts';
import { prepareNativeSession } from './native-prepare.ts';
import { placeChat } from '../orchestration/chat-place.ts';
import { dependenciesLine, startTimer, type StartTimer } from './start-timing.ts';
import { sessionDeps } from './session-deps.ts';
import { startPhases } from './start-phases.ts';
import { assertTerminalChat, providerToLaunch } from './native-launch-checks.ts';
import { writeAdoptRecord } from './tmux/adopt-record.ts';
import { readoptTmuxSessions } from './tmux/readopt.ts';
import { terminalApprovals } from './remote/approvals.ts';
import { modInbox } from './remote/mod-inbox.ts';
import { answerWaits, withMod } from './remote/mod-routing.ts';
import { nativeRemote, remoteHookHandlers } from './remote/native-remote.ts';

export type { NativeRuntime, NativeRuntimeDeps } from './native-runtime-types.ts';
import type { NativeRuntime, NativeRuntimeDeps, LiveSession } from './native-runtime-types.ts';

export async function createNativeRuntime(deps: NativeRuntimeDeps): Promise<NativeRuntime> {
  const live = new Map<string, LiveSession>();
  const tokens = new Map<string, LiveSession>();
  const launches = new Map<string, { key: string; work: Promise<NativeTerminalLaunchResponse> }>();
  const stoppedLaunches = new Set<string>();
  const waiters = deps.approvalWaiters ?? new ApprovalWaiters();
  const phases = startPhases(deps.onStartPhase ?? (() => undefined));
  const dependencies = sessionDeps({
    ...(deps.prepareDependencies ? { prepare: deps.prepareDependencies } : {}),
    ...(deps.onStartPhase ? { changed: deps.onStartPhase } : {}),
    ended: (result) => {
      const sessionId = live.get(result.conversationId)?.row.id ?? null;
      if (result.outcome !== 'nothing')
        (deps.logStart ?? console.log)(dependenciesLine({ ...result, sessionId }));
    },
  });
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
  const usage = nativeUsage(deps.db, deps.watchTranscript ?? watchTranscript, enqueue);
  const control = nativeControl(deps.db, live, tokens, usage);
  const { syncScope, finish } = control;
  const { hook, resumeUsage, telemetry } = nativeObserver({
    db: deps.db,
    waiters,
    tokens,
    enqueue,
    control,
    usage,
  });
  const approvals = terminalApprovals();
  const waitsForAnswer = answerWaits(approvals, deps.db);
  const mod = modInbox({ db: deps.db, workspaceId: deps.workspaceId, waitsForAnswer });
  const remote = withMod(
    nativeRemote({
      db: deps.db,
      workspaceId: deps.workspaceId,
      live,
      terminals: deps.terminals,
      approvals,
      owned,
    }),
    mod,
    waitsForAnswer,
  );
  const handlers = remoteHookHandlers(remote, (token) => tokens.get(digest(token)), hook);
  const host = await nativeHookHost(
    (token) => tokens.has(digest(token)),
    handlers.observe,
    handlers.permission,
    async (token) => {
      const session = tokens.get(digest(token));
      return session ? mod.poll(session) : null;
    },
    telemetry,
  );
  const exited = (running: LiveSession) => (exit: { exitCode: number }) => {
    const state = exit.exitCode === 0 ? 'exited' : 'error';
    remote.ended(running.row.conversation_id);
    void enqueue(running, async () => {
      await finish(running, state, false, `Native agent exited (${exit.exitCode}).`).finally(() =>
        usage.last(running).catch(() => undefined),
      );
    }).catch(() => undefined);
  };
  const launchOnce = async (
    conversationId: string,
    request: NativeTerminalLaunchRequest,
    timer: StartTimer,
  ): Promise<NativeTerminalLaunchResponse> => {
    if (disposed) throw new NativeRuntimeError('The terminal host is stopping.', 503);
    const conversation = await owned(conversationId);
    assertTerminalChat(conversation, request);
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
    const provider = providerToLaunch(conversation.terminal_provider, request, previous);
    timer.provider(provider);
    phases.set(conversationId, 'preparing');
    const command = await timer.time('locate_cli', () =>
      (deps.locateCli ?? loginShellLocator(process.env.SHELL || '/bin/zsh'))(provider),
    );
    if (!command)
      throw new NativeRuntimeError(
        `Install ${provider === 'claude' ? 'Claude Code' : 'Codex'} before opening its terminal.`,
      );
    const prepared = await timer.time('prepare_session', () =>
      prepareNativeSession(
        {
          ...deps,
          place: timer.place(deps.place ?? placeChat),
          onPhase: (phase) => phases.set(conversationId, phase),
          prepareLater: (job) => dependencies.start(conversationId, job),
        },
        conversationId,
        provider,
        request,
        previous,
      ),
    );
    if (disposed || stoppedLaunches.has(conversationId)) {
      await dependencies.stop(conversationId);
      if (prepared.runId) await cancelRun(deps.db, prepared.runId);
      throw new NativeRuntimeError('This terminal launch was stopped.', 409);
    }
    await dependencies.resume(deps.db, conversationId, prepared.folder.cwd);
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
    timer.session(row.id);
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
      phases.set(conversationId, 'agent');
      const granted = await timer.time('grant', () => deps.mcp.grant(scope));
      grant = granted;
      const prepareLaunch = deps.prepareLaunch ?? prepareNativeLaunch;
      launch = await timer.time('prepare_launch', () =>
        prepareLaunch({
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
          mcp: granted,
          hooks: { url: host.url, token, permissionUrl: host.permissionUrl },
        }),
      );
      row.observation = launch.observation;
      const ceiling = prepared.input.agentMode ?? (provider === 'claude' ? 'auto' : 'agent');
      if (deps.tmux && launch.directory)
        await writeAdoptRecord(launch.directory, {
          grant: sparkGrantKey(grant.token),
          mcpPort: deps.mcp.port,
          ceiling,
        });
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
        ceiling,
        seedPending: prepared.runId !== null,
        nativeSessionEnded: false,
        observedTurnId: null,
        chain: Promise.resolve(),
        hookKey: digest(token),
        completedTurns: new Set(),
        currentPromptEventId: null,
        completedEvents: new Map(),
        transcript: null,
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
        colors: request.colors,
        observer: timer.observer,
        onExit: exited(running),
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
        await usage.last(session).catch(() => undefined);
        await session.context?.close();
      }
      grant?.revoke();
      await launch?.dispose();
      const cancelled =
        disposed ||
        stoppedLaunches.has(conversationId) ||
        (prepared.runId !== null && (await isCancelRequested(deps.db, prepared.runId)));
      const failure = nativeLaunchError(error);
      const reason = cancelled ? STOPPED_BY_USER : failure.message;
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
    remote.ended(conversationId);
    await dependencies.stop(conversationId);
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
        await enqueue(session, () => finish(session, 'exited', true, STOPPED_BY_USER));
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
    remote,
    async get(conversationId) {
      await owned(conversationId);
      const row = await nativeTerminalRow(deps.db, conversationId);
      if (!row) return null;
      const readopted = live.get(conversationId)?.readopted ?? null;
      const preparing = dependencies.status(conversationId);
      return {
        ...nativeTerminalView(row, await nativeTerminalMode(deps.db, row)),
        readopted,
        dependencies: preparing,
      };
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
      const timer = startTimer(deps.logStart ?? console.log);
      const work = timer.watch(launchOnce(conversationId, request, timer)).finally(() => {
        launches.delete(conversationId);
        phases.clear(conversationId);
      });
      launches.set(conversationId, { key, work });
      return work;
    },
    async usage(conversationId) {
      await owned(conversationId);
      const row = live.has(conversationId)
        ? null
        : await nativeTerminalRow(deps.db, conversationId);
      if (row) await usage.catchUpStored(row).catch(() => undefined);
      return nativeTerminalUsage(deps.db, conversationId);
    },
    async startPhase(conversationId) {
      await owned(conversationId);
      return phases.get(conversationId);
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
    saveImage: (conversationId, attachmentId) =>
      saveSessionImage(deps.db, deps.workspaceId, live.get(conversationId), attachmentId),
    async attachSession(id) {
      return attachNativeSession(deps.db, deps.workspaceId, deps.terminals, live, launches, id);
    },
    async recover() {
      if (live.size) throw new NativeRuntimeError('Recovery requires a stopped terminal host.');
      const kept = deps.tmux
        ? await readoptTmuxSessions({
            tmux: deps.tmux,
            db: deps.db,
            workspaceId: deps.workspaceId,
            dataDir: deps.dataDir,
            channel: deps.channel,
            mcp: deps.mcp,
            terminals: deps.terminals,
            waiters,
            hookUrl: host.url,
            permissionUrl: host.permissionUrl,
            live,
            tokens,
            now: deps.now ?? (() => new Date()),
            syncScope,
            resumeUsage,
            onExit: exited,
          })
        : [];
      await recoverNativeTerminals(deps.db, kept);
      for (const session of live.values())
        await dependencies
          .resume(deps.db, session.row.conversation_id, session.row.cwd)
          .catch(() => undefined);
    },
    async detach() {
      disposed = true;
      try {
        await dependencies.stopAll();
        for (const session of [...live.values()]) {
          await enqueue(session, async () => {
            await usage.last(session).catch(() => undefined);
            await session.context?.close();
          }).catch(() => undefined);
          if (!deps.terminals.detach(session.row.id)) await stop(session.row.conversation_id);
        }
        await Promise.all(
          [...launches.values()].map((launch) => launch.work.catch(() => undefined)),
        );
      } finally {
        await host.close();
      }
    },
    async dispose() {
      disposed = true;
      try {
        await dependencies.stopAll();
        await stopAll();
      } finally {
        await host.close();
      }
    },
  };
}
