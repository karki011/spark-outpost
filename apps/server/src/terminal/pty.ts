import os from 'node:os';
import { spawn as spawnNodePty } from 'node-pty';
import { childEnvironment } from '../setup/environment.ts';

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: { exitCode: number; signal?: number | undefined }) => void): void;
}

export interface PtyOptions {
  cols: number;
  rows: number;
}

export type SpawnPty = (options: PtyOptions) => PtyProcess;

export function shellEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return { ...childEnvironment(env), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

export function loginShellSpawner(shell = process.env.SHELL || '/bin/zsh'): SpawnPty {
  return ({ cols, rows }) => {
    const pty = spawnNodePty(shell, ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: shellEnvironment(process.env),
    });
    return {
      pid: pty.pid,
      write: (data) => pty.write(data),
      resize: (c, r) => pty.resize(c, r),
      onData: (listener) => {
        pty.onData(listener);
      },
      onExit: (listener) => {
        pty.onExit(listener);
      },
    };
  };
}
