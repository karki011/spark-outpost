import { execFile } from 'node:child_process';
import { connect } from 'node:net';

export interface Outcome {
  code: number | null;
  output: string;
}

const OUTPUT_TAIL = 600;

export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs = 300_000,
): Promise<Outcome> {
  return new Promise((done) => {
    execFile(
      command,
      [...args],
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        if (!error) return done({ code: 0, output });
        done({ code: typeof error.code === 'number' ? error.code : null, output });
      },
    );
  });
}

export function tail(output: string): string {
  return output.trim().slice(-OUTPUT_TAIL);
}

export function node(args: readonly string[], cwd: string, timeoutMs?: number): Promise<Outcome> {
  return runCommand(process.execPath, args, cwd, timeoutMs);
}

export function git(repo: string, ...args: string[]): Promise<Outcome> {
  return runCommand('git', ['-C', repo, ...args], repo);
}

function lines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function changedPaths(repo: string, baseCommit: string): Promise<string[]> {
  const tracked = await git(repo, 'diff', '--name-only', baseCommit);
  const untracked = await git(repo, 'ls-files', '--others', '--exclude-standard');
  return [...new Set([...lines(tracked.output), ...lines(untracked.output)])].sort();
}

export async function sameAsBase(repo: string, baseCommit: string, path: string): Promise<boolean> {
  const diff = await git(repo, 'diff', '--quiet', baseCommit, '--', path);
  return diff.code === 0;
}

export async function headIs(repo: string, baseCommit: string): Promise<boolean> {
  const head = await git(repo, 'rev-parse', 'HEAD');
  return head.output.trim() === baseCommit;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
