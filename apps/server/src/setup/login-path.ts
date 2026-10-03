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
