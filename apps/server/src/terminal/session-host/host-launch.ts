import { spawn } from 'node:child_process';
import path from 'node:path';
import { childEnvironment } from '../../setup/environment.ts';
import type { SessionHostPaths } from './paths.ts';

export const HOST_ENTRY = path.join(import.meta.dirname, 'host-entry.ts');
const SERVER_DIR = path.resolve(import.meta.dirname, '../../..');
const CTL_TIMEOUT_MS = 30_000;
const STDERR_MAX = 64 * 1024;
const DROPPED_FLAG = /^--(?:watch|env-file)/;

export interface NodeLauncher {
  file: string;
  args: readonly string[];
  env: Record<string, string>;
}

interface RunningNode {
  execPath: string;
  execArgv: readonly string[];
  argv: readonly string[];
  versions: Readonly<Record<string, string | undefined>>;
  env: NodeJS.ProcessEnv;
}

export function nodeLauncher(self: RunningNode = process): NodeLauncher {
  const env = childEnvironment(self.env);
  if (self.versions.electron) {
    return {
      file: self.execPath,
      args: [self.argv[1] ?? '', HOST_ENTRY],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }
  const args: string[] = [];
  for (const flag of self.execArgv) if (!DROPPED_FLAG.test(flag)) args.push(flag);
  return { file: self.execPath, args: [...args, HOST_ENTRY], env };
}

export function startHostProcess(launcher: NodeLauncher, directory: string): void {
  const child = spawn(launcher.file, [...launcher.args, 'serve', directory], {
    cwd: SERVER_DIR,
    env: launcher.env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => undefined);
  child.unref();
}

function lastLine(text: string): string | null {
  const line = text.trim().split('\n').pop()?.trim();
  return line ? line.slice(0, 300) : null;
}

export function runHostHelper(launcher: NodeLauncher, paths: SessionHostPaths): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher.file, [...launcher.args, 'ctl', paths.directory], {
      cwd: SERVER_DIR,
      env: launcher.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: CTL_TIMEOUT_MS,
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < STDERR_MAX) stderr += chunk;
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(lastLine(stderr) ?? 'the session host did not start'));
    });
  });
}

const starting = new Map<string, Promise<void>>();

export function ensureHost(
  launcher: NodeLauncher,
  paths: SessionHostPaths,
  run: typeof runHostHelper = runHostHelper,
): Promise<void> {
  const running = starting.get(paths.directory);
  if (running) return running;
  const started = run(launcher, paths).finally(() => starting.delete(paths.directory));
  starting.set(paths.directory, started);
  return started;
}
