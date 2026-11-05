import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const MARKER = '__SPARK_PATH__';
const SHELL_PATH_TIMEOUT_MS = 5_000;
const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

type ShellRunner = (shell: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);
const defaultRunner: ShellRunner = async (shell, args) =>
  (await execFileAsync(shell, args, { timeout: SHELL_PATH_TIMEOUT_MS })).stdout;

export function parseShellPath(output: string): string | null {
  const start = output.indexOf(MARKER);
  const end = output.indexOf(MARKER, start + MARKER.length);
  if (start < 0 || end < 0) return null;
  const value = output.slice(start + MARKER.length, end).trim();
  return value || null;
}

export function mergePath(...parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  for (const part of parts) {
    for (const dir of (part ?? '').split(':')) {
      if (dir) seen.add(dir);
    }
  }
  return [...seen].join(':');
}

export async function loginShellPath(
  shell: string,
  run: ShellRunner = defaultRunner,
): Promise<string | null> {
  try {
    return parseShellPath(await run(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`]));
  } catch {
    return null;
  }
}

export async function adoptLoginShellPath(
  env: NodeJS.ProcessEnv,
  run: ShellRunner = defaultRunner,
): Promise<void> {
  const fromShell = await loginShellPath(env.SHELL || '/bin/zsh', run);
  env.PATH = mergePath(fromShell, env.PATH, FALLBACK_DIRS.join(':'));
}
