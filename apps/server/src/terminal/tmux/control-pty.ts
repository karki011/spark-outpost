import { StringDecoder } from 'node:string_decoder';
import type { PtyProcess } from '../pty.ts';
import { openControlClient, type ControlClient, type OpenControlClient } from './control-client.ts';
import { requestSeed } from './control-seed.ts';
import type { TmuxHost } from './tmux-host.ts';
import {
  createSession,
  secretEnvNames,
  killSession,
  paneQuery,
  parsePane,
  readPane,
  RELEASE_HELD_START,
  type TmuxPane,
  type TmuxStart,
} from './tmux-session.ts';

type Exit = { exitCode: number; signal?: number | undefined };

const INPUT_CHUNK_BYTES = 256;
const LOST_EXIT_CODE = 1;
const SPLIT_WRITE_MS = 1;
const SIGHUP = 1;

export function hexWords(data: Buffer): string {
  const words: string[] = [];
  for (const byte of data) words.push(byte.toString(16).padStart(2, '0'));
  return words.join(' ');
}

export function paneExit(pane: Pick<TmuxPane, 'exitCode' | 'signal'>): Exit {
  return { exitCode: pane.exitCode ?? 0, ...(pane.signal === null ? {} : { signal: pane.signal }) };
}

export interface ControlPtyStart extends TmuxStart {
  adopt: boolean;
}

export function controlPty(
  host: TmuxHost,
  start: ControlPtyStart,
  open: OpenControlClient = openControlClient,
): PtyProcess {
  const adopted = start.adopt ? readPane(host, start.sessionId) : null;
  if (start.adopt && !adopted) throw new Error('That terminal session is no longer running.');
  const pane = adopted ?? createSession(host, start);
  const decoder = new StringDecoder('utf8');
  const dataListeners: ((data: string) => void)[] = [];
  const exitListeners: ((exit: Exit) => void)[] = [];
  let client: ControlClient;
  let seeded = !start.adopt;
  let answered = false;
  let ended = false;

  let batch = '';
  const flush = () => {
    const text = batch;
    batch = '';
    if (text) for (const listener of dataListeners) listener(text);
  };
  const emit = (text: string) => {
    if (!text) return;
    if (!batch) setTimeout(flush, SPLIT_WRITE_MS);
    batch += text;
  };
  const exit = (result: Exit) => {
    if (ended) return;
    ended = true;
    flush();
    killSession(host, start.sessionId, null);
    client.close();
    for (const listener of exitListeners) listener(result);
  };
  const checkDeath = () =>
    client.command(paneQuery(pane.paneId), (lines) => {
      answered = true;
      const now = lines?.[0] ? parsePane(lines[0]) : null;
      if (now?.dead) exit(paneExit(now));
    });
  const lost = () => {
    if (ended) return;
    const now = readPane(host, start.sessionId);
    if (now?.dead) return exit(paneExit(now));
    if (!now || !answered) return exit({ exitCode: LOST_EXIT_CODE });
    answered = false;
    connect();
  };
  function connect() {
    client = open(host, start.sessionId);
    client.onOutput((paneId, data) => {
      if (seeded && paneId === pane.paneId) emit(decoder.write(data));
    });
    client.onNotice((name) => {
      if (name === 'window-renamed') checkDeath();
    });
    client.onClosed(lost);
    checkDeath();
  }

  connect();
  if (start.adopt) {
    requestSeed(client!, pane.paneId, (text) => {
      emit(text);
      seeded = true;
    });
  } else {
    client!.command(`refresh-client -C ${Math.trunc(start.cols)}x${Math.trunc(start.rows)}`);
    client!.command(`send-keys -H -t ${pane.paneId} ${RELEASE_HELD_START}`);
    for (const name of secretEnvNames(start.env))
      client!.command(`set-environment -u -t ${pane.paneId} ${name}`);
  }

  return {
    pid: pane.pid,
    write: (data) => {
      const bytes = Buffer.from(data, 'utf8');
      for (let offset = 0; offset < bytes.length; offset += INPUT_CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + INPUT_CHUNK_BYTES);
        client.command(`send-keys -H -t ${pane.paneId} ${hexWords(chunk)}`);
      }
    },
    resize: (cols, rows) =>
      client.command(`refresh-client -C ${Math.trunc(cols)}x${Math.trunc(rows)}`),
    onData: (listener) => {
      dataListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    kill: () => {
      if (ended) return;
      ended = true;
      killSession(host, start.sessionId, pane.dead ? null : pane.pid);
      client.close();
      setImmediate(() => {
        for (const listener of exitListeners) listener({ exitCode: 0, signal: SIGHUP });
      });
    },
    detach: () => {
      if (ended) return;
      ended = true;
      client.close();
    },
  };
}
