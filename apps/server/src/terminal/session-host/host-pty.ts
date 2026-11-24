import type { PtyProcess } from '../pty.ts';
import { createAnsweredQueryFilter } from '../tmux/answered-queries.ts';
import { openHostConnection, type HostConnection } from './host-connection.ts';
import { createHostSession, type NodeLauncher } from './host-launch.ts';
import type { SessionHostPaths } from './paths.ts';
import { attachedSchema, type CreateRequest, type HostExit, type HostRequest } from './protocol.ts';

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

export function exitOf(exit: HostExit): Exit {
  return { exitCode: exit.exitCode, ...(exit.signal === null ? {} : { signal: exit.signal }) };
}

export function hostPty(
  config: SessionHostConfig,
  start: HostPtyStart,
  known: (session: string) => number | null,
  open: typeof openHostConnection = openHostConnection,
): PtyProcess {
  const session = start.create.session;
  const adoptedPid = start.adopt ? known(session) : null;
  if (start.adopt && adoptedPid === null)
    throw new Error('That terminal session is no longer running.');
  const pid = adoptedPid ?? createHostSession(config.launcher, config.paths, start.create);
  const dataListeners: ((data: string) => void)[] = [];
  const exitListeners: ((exit: Exit) => void)[] = [];
  const queued: HostRequest[] = [];
  let connection: HostConnection | null = null;
  let ended = false;
  let reconnected = false;

  const emit = (text: string) => {
    if (text) for (const listener of dataListeners) listener(text);
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
        for (const listener of exitListeners) listener(result);
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

  const connect = async (replayFilter: ((text: string) => string) | null) => {
    const opened = await open(config.paths);
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
    void connect(createAnsweredQueryFilter());
  }

  void connect(start.adopt ? createAnsweredQueryFilter() : null);

  return {
    pid,
    write: (data) => send({ kind: 'write', session, data }),
    resize: (cols, rows) =>
      send({
        kind: 'resize',
        session,
        cols: Math.max(1, Math.trunc(cols)),
        rows: Math.max(1, Math.trunc(rows)),
      }),
    onData: (listener) => {
      dataListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    kill: () => {
      if (ended) return;
      ended = true;
      const closing = connection;
      connection = null;
      const killing = closing
        ? closing.request({ kind: 'kill', session })
        : open(config.paths).then((fresh) =>
            fresh?.request({ kind: 'kill', session }).finally(() => fresh.close()),
          );
      void killing
        .catch(() => undefined)
        .finally(() => {
          closing?.close();
          for (const listener of exitListeners) listener({ exitCode: 0, signal: SIGHUP });
        });
    },
    detach: () => {
      if (ended) return;
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
