import type { RunCommand } from './command.ts';

const LOOKUP_TIMEOUT_MS = 10_000;
const MARKER = '__SPARK_PATH__=';

const cached = new Map<string, Promise<string | null>>();

async function readLoginPath(run: RunCommand, shell: string): Promise<string | null> {
  const result = await run(shell, ['-ilc', `printf '${MARKER}%s\\n' "$PATH"`], LOOKUP_TIMEOUT_MS);
  if (result.code !== 0) return null;
  const line = result.stdout.split('\n').findLast((candidate) => candidate.startsWith(MARKER));
  return line ? line.slice(MARKER.length).trim() || null : null;
}

export function loginShellPath(
  run: RunCommand,
  shell: string | null,
): () => Promise<string | null> {
  return () => {
    if (!shell) return Promise.resolve(null);
    const known = cached.get(shell);
    if (known) return known;
    const lookup = readLoginPath(run, shell).catch(() => null);
    cached.set(shell, lookup);
    return lookup;
  };
}

const ENV_MARKER = '__SPARK_ENV__';
const SHELL_ONLY = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD']);

const cachedEnv = new Map<string, Promise<Record<string, string> | null>>();

export function parseLoginEnv(stdout: string): Record<string, string> | null {
  const start = stdout.lastIndexOf(ENV_MARKER);
  if (start < 0) return null;
  const pairs = stdout
    .slice(start + ENV_MARKER.length)
    .split('\0')
    .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)])
    .filter(([name]) => name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !SHELL_ONLY.has(name));
  return pairs.length > 0 ? (Object.fromEntries(pairs) as Record<string, string>) : null;
}

async function readLoginEnv(run: RunCommand, shell: string) {
  const result = await run(shell, ['-ilc', `printf '${ENV_MARKER}'; env -0`], LOOKUP_TIMEOUT_MS);
  return result.code === 0 ? parseLoginEnv(result.stdout) : null;
}

export function loginShellEnv(
  run: RunCommand,
  shell: string | null,
): () => Promise<Record<string, string> | null> {
  return () => {
    if (!shell) return Promise.resolve(null);
    const known = cachedEnv.get(shell);
    if (known) return known;
    const lookup = readLoginEnv(run, shell).catch(() => null);
    cachedEnv.set(shell, lookup);
    return lookup;
  };
}
