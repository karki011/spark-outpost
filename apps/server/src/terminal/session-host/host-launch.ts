import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { childEnvironment } from '../../setup/environment.ts';
import type { SessionHostPaths } from './paths.ts';
import { createdSchema, type CreateRequest } from './protocol.ts';

export const HOST_ENTRY = path.join(import.meta.dirname, 'host-entry.ts');
const SERVER_DIR = path.resolve(import.meta.dirname, '../../..');
const CTL_TIMEOUT_MS = 30_000;
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

function ctlFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const line = typeof stderr === 'string' ? stderr.trim().split('\n').pop() : undefined;
  return line ? line.slice(0, 300) : 'the session host did not start the session';
}

export function createHostSession(
  launcher: NodeLauncher,
  paths: SessionHostPaths,
  start: CreateRequest,
): number {
  let printed: string;
  try {
    printed = execFileSync(launcher.file, [...launcher.args, 'ctl', paths.directory], {
      cwd: SERVER_DIR,
      env: launcher.env,
      input: JSON.stringify(start),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CTL_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(ctlFailure(error), { cause: error });
  }
  const last = printed.trim().split('\n').pop() ?? '';
  return createdSchema.parse(JSON.parse(last)).pid;
}
