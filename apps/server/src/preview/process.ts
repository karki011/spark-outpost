import { stat } from 'node:fs/promises';
import net from 'node:net';
import { spawn as spawnNodePty } from 'node-pty';
import { killProcessTree } from '../terminal/process-group.ts';
import type { PreviewProcess, PreviewRuntime, PreviewSpawn } from './servers.ts';

const CONNECT_TIMEOUT_MS = 400;
const ANSWER_TIMEOUT_MS = 2_000;
const LOOPBACK = ['127.0.0.1', '::1'];
const SIZE = { cols: 120, rows: 30 };

function listening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function portFree(port: number): Promise<boolean> {
  const open = await Promise.all(LOOPBACK.map((host) => listening(host, port)));
  return !open.some(Boolean);
}

export async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

function spawnInLoginShell(shell: string) {
  return ({ command, cwd, env }: PreviewSpawn): PreviewProcess => {
    const pty = spawnNodePty(shell, ['-ilc', command], {
      name: 'xterm-256color',
      ...SIZE,
      cwd,
      env,
    });
    return {
      pid: pty.pid,
      write: (data) => pty.write(data),
      resize: (cols, rows) => pty.resize(cols, rows),
      onData: (listener) => {
        pty.onData(listener);
      },
      onExit: (listener) => {
        pty.onExit(({ exitCode }) => listener({ exitCode }));
      },
      kill: () => killProcessTree(pty.pid),
    };
  };
}

export function previewRuntime(
  env: NodeJS.ProcessEnv = process.env,
  shell = env.SHELL || '/bin/zsh',
): PreviewRuntime {
  return {
    spawn: spawnInLoginShell(shell),
    portFree,
    answers,
    env,
    folderExists: (folder) =>
      stat(folder).then(
        (info) => info.isDirectory(),
        () => false,
      ),
  };
}
