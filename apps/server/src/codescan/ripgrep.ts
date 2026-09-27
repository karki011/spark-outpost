import { rgPath } from '@vscode/ripgrep';
import { runCommand } from './processes.ts';
import { isSkipped, MAX_FILE_BYTES } from './skip.ts';

export const MAX_MATCHES_PER_FILE = 3;

export interface TextMatch {
  count: number;
  terms: Set<string>;
}

const EXCLUDED_GLOBS = ['node_modules', 'vendor', 'dist', 'build', 'coverage', '.git'].flatMap(
  (directory) => ['--glob', `!**/${directory}/**`],
);

export function parseMatches(output: string, patterns: readonly string[]) {
  const known = new Set(patterns);
  const matches = new Map<string, TextMatch>();
  for (const line of output.split('\n')) {
    const cut = line.indexOf('\0');
    if (cut === -1) continue;
    const path = line.slice(0, cut).replace(/^\.\//, '');
    const term = line.slice(cut + 1);
    if (!known.has(term) || isSkipped(path)) continue;
    const entry = matches.get(path) ?? { count: 0, terms: new Set<string>() };
    entry.count += 1;
    entry.terms.add(term);
    matches.set(path, entry);
  }
  return matches;
}

export async function searchText(
  root: string,
  patterns: readonly string[],
  excludes: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, TextMatch>> {
  if (patterns.length === 0) return new Map();
  const args = [
    '--only-matching',
    '--no-line-number',
    '--with-filename',
    '--null',
    '--no-messages',
    '--fixed-strings',
    `--max-count=${MAX_MATCHES_PER_FILE}`,
    `--max-filesize=${MAX_FILE_BYTES}`,
    ...EXCLUDED_GLOBS,
    ...excludes.flatMap((directory) => ['--glob', `!${directory}/**`]),
    ...patterns.flatMap((pattern) => ['-e', pattern]),
    '.',
  ];
  const output = await runCommand(rgPath, args, {
    cwd: root,
    okCodes: [0, 1, 2],
    ...(signal ? { signal } : {}),
  });
  return parseMatches(output, patterns);
}
