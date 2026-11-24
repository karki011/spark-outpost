import { killProcessTree } from '../process-group.ts';
import type { PtyProcess } from '../pty.ts';
import { createAnsweredQueryFilter } from '../tmux/answered-queries.ts';
import { openHostConnection, type HostConnection } from './host-connection.ts';
import { ensureHost, type NodeLauncher } from './host-launch.ts';
import type { SessionHostPaths } from './paths.ts';
import {
  attachedSchema,
  createdSchema,
  type CreateRequest,
  type HostExit,
  type HostRequest,
} from './protocol.ts';

type Exit = { exitCode: number; signal?: number | undefined };

const LOST_EXIT_CODE = 1;
const SIGHUP = 1;

export interface SessionHostConfig {
  paths: SessionHostPaths;
  launcher: NodeLauncher;
}

export interface HostPtyStart {
  create: CreateRequest;
  adopt: boolean;
}

export interface HostPtyDeps {
  open?: typeof openHostConnection;
  ensure?: () => Promise<void>;
  fallback?: (error: Error) => PtyProcess;
  created?: () => void;
}

export function exitOf(exit: HostExit): Exit {
  return { exitCode: exit.exitCode, ...(exit.signal === null ? {} : { signal: exit.signal }) };
}

async function openOrStartHost(
  config: SessionHostConfig,
  open: typeof openHostConnection = openHostConnection,
  ensure: () => Promise<void> = () => ensureHost(config.launcher, config.paths),
): Promise<HostConnection> {
  const first = await open(config.paths);
  if (first) return first;
  await ensure();
  const started = await open(config.paths);
  if (!started) throw new Error('The session host did not start.');
  return started;
}

export function hostPty(
  config: SessionHostConfig,
  start: HostPtyStart,
  known: (session: string) => number | null,
  deps: HostPtyDeps = {},
): PtyProcess {
  const open = deps.open ?? openHostConnection;
  const session = start.create.session;
  const adoptedPid = start.adopt ? known(session) : null;
  if (start.adopt && adoptedPid === null)
    throw new Error('That terminal session is no longer running.');
  const dataListeners: ((data: string) => void)[] = [];
  const exitListeners: ((exit: Exit) => void)[] = [];
  const queued: HostRequest[] = [];
  let pid = adoptedPid ?? 0;
  let direct: PtyProcess | null = null;
  let connection: HostConnection | null = null;
  let ended = false;
  let reconnected = false;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const emit = (text: string) => {
    if (text) for (const listener of dataListeners) listener(text);
  };
  const exited = (result: Exit) => {
    for (const listener of exitListeners) listener(result);
  };
  const finish = (result: Exit) => {
    if (ended) return;
    ended = true;
    const closing = connection;
    connection = null;
    void (closing?.request({ kind: 'remove', session }) ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        closing?.close();
        exited(result);
      });
  };
  const send = (request: HostRequest) => {
    if (ended) return;
    if (!connection) {
      queued.push(request);
      return;
    }
    void connection.request(request).catch(() => undefined);
  };

  const attach = async (
    opened: HostConnection | null,
    replayFilter: ((text: string) => string) | null,
  ) => {
    if (ended) return opened?.close();
    if (!opened) return lost();
    opened.onEvent((event) => {
      if (event.session !== session || connection !== opened) return;
      if (event.kind === 'output') emit(event.data);
      else finish(exitOf(event.exit));
    });
    opened.onClose(() => {
      if (connection === opened) lost();
    });
    let attached;
    try {
      attached = attachedSchema.parse(await opened.request({ kind: 'attach', session }));
    } catch {
      opened.close();
      if (!ended) finish({ exitCode: LOST_EXIT_CODE });
      return;
    }
    if (ended) return opened.close();
    connection = opened;
    emit(replayFilter ? replayFilter(attached.replay) : attached.replay);
    if (attached.exit) return finish(exitOf(attached.exit));
    for (const request of queued.splice(0)) send(request);
  };
  function lost() {
    if (ended) return;
    connection = null;
    if (reconnected) return finish({ exitCode: LOST_EXIT_CODE });
    reconnected = true;
    void open(config.paths).then((opened) => attach(opened, createAnsweredQueryFilter()));
  }

  const runDirect = (error: Error) => {
    let fallback: PtyProcess;
    try {
      if (!deps.fallback) throw error;
      fallback = deps.fallback(error);
    } catch {
      return finish({ exitCode: LOST_EXIT_CODE });
    }
    direct = fallback;
    pid = fallback.pid;
    fallback.onData(emit);
    fallback.onExit((result) => {
      if (ended) return;
      ended = true;
      exited(result);
    });
    for (const request of queued.splice(0)) {
      if (request.kind === 'write') fallback.write(request.data);
      if (request.kind === 'resize') fallback.resize(request.cols, request.rows);
    }
  };

  const create = async (): Promise<boolean> => {
    let opened: HostConnection | null = null;
    try {
      opened = await openOrStartHost(config, open, deps.ensure);
      pid = createdSchema.parse(await opened.request(start.create)).pid;
    } catch (error) {
      opened?.close();
      if (!ended) runDirect(error as Error);
      markReady();
      return false;
    }
    deps.created?.();
    markReady();
    void attach(opened, null);
    return true;
  };

  const created: Promise<boolean> = start.adopt ? Promise.resolve(true) : create();
  if (start.adopt) {
    markReady();
    void open(config.paths).then((opened) => attach(opened, createAnsweredQueryFilter()));
  }

  const killInHost = async (closing: HostConnection | null) => {
    if (!(await created)) return;
    if (closing) return closing.request({ kind: 'kill', session });
    const fresh = await open(config.paths);
    await fresh?.request({ kind: 'kill', session }).finally(() => fresh.close());
  };

  return {
    get pid() {
      return pid;
    },
    ready,
    write: (data) => {
      if (direct) direct.write(data);
      else send({ kind: 'write', session, data });
    },
    resize: (cols, rows) => {
      if (direct) return direct.resize(cols, rows);
      send({
        kind: 'resize',
        session,
        cols: Math.max(1, Math.trunc(cols)),
        rows: Math.max(1, Math.trunc(rows)),
      });
    },
    onData: (listener) => {
      dataListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    kill: () => {
      if (direct) {
        if (direct.kill) direct.kill();
        else void killProcessTree(direct.pid);
        return;
      }
      if (ended) return;
      ended = true;
      const closing = connection;
      connection = null;
      void killInHost(closing)
        .catch(() => undefined)
        .finally(() => {
          closing?.close();
          exited({ exitCode: 0, signal: SIGHUP });
        });
    },
    detach: () => {
      if (direct || ended) return;
      ended = true;
      const closing = connection;
      connection = null;
      closing?.close();
    },
    screen: async () => {
      if (!connection) return null;
      const text = await connection.request({ kind: 'screen', session }).catch(() => null);
      return typeof text === 'string' ? text : null;
    },
  };
}
