import { spawn } from 'node:child_process';
import { createControlParser } from './control-protocol.ts';
import { tmuxArgs, type TmuxHost } from './tmux-host.ts';
import { sessionName } from './tmux-session.ts';

type Reply = (lines: string[] | null) => void;

export interface ControlClient {
  command(text: string, onReply?: Reply): void;
  onOutput(listener: (paneId: string, data: Buffer) => void): void;
  onNotice(listener: (name: string) => void): void;
  onClosed(listener: () => void): void;
  close(): void;
}

export type OpenControlClient = (host: TmuxHost, sessionId: string) => ControlClient;

export const openControlClient: OpenControlClient = (host, sessionId) => {
  const child = spawn(
    host.bin,
    tmuxArgs(host, ['-C', 'attach-session', '-t', `=${sessionName(sessionId)}`]),
    { cwd: host.directory, env: host.env, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const ignore: Reply = () => undefined;
  const waiting: Reply[] = [ignore];
  const outputListeners: ((paneId: string, data: Buffer) => void)[] = [];
  const noticeListeners: ((name: string) => void)[] = [];
  const closedListeners: (() => void)[] = [];
  let closed = false;

  const parse = createControlParser((event) => {
    if (event.type === 'output') {
      for (const listener of outputListeners) listener(event.paneId, event.data);
    } else if (event.type === 'reply') {
      waiting.shift()?.(event.ok ? event.lines : null);
    } else if (event.type === 'notice') {
      for (const listener of noticeListeners) listener(event.name);
    }
  });
  const finish = () => {
    if (closed) return;
    closed = true;
    for (const reply of waiting.splice(0)) reply(null);
    for (const listener of closedListeners) listener();
  };
  child.stdout.on('data', parse);
  child.stdin.on('error', () => undefined);
  child.once('error', finish);
  child.once('exit', finish);

  return {
    command: (text, onReply = ignore) => {
      if (closed) return onReply(null);
      waiting.push(onReply);
      child.stdin.write(`${text}\n`);
    },
    onOutput: (listener) => {
      outputListeners.push(listener);
    },
    onNotice: (listener) => {
      noticeListeners.push(listener);
    },
    onClosed: (listener) => {
      closedListeners.push(listener);
    },
    close: () => {
      if (closed) return;
      closedListeners.length = 0;
      child.stdin.end();
      child.kill('SIGTERM');
    },
  };
};
