import { StringDecoder } from 'node:string_decoder';
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

export interface MatchReader {
  matches: Map<string, TextMatch>;
  read(text: string): void;
  end(): void;
}

export function matchReader(patterns: readonly string[]): MatchReader {
  const known = new Set(patterns);
  const matches = new Map<string, TextMatch>();
  const skipped = new Set<string>();
  let pending = '';
  const readLine = (line: string) => {
    const cut = line.indexOf('\0');
    if (cut === -1) return;
    const term = line.slice(cut + 1);
    if (!known.has(term)) return;
    const raw = line.slice(0, cut);
    const path = raw.startsWith('./') ? raw.slice(2) : raw;
    if (skipped.has(path)) return;
    let entry = matches.get(path);
    if (!entry) {
      if (isSkipped(path)) {
        skipped.add(path);
        return;
      }
      entry = { count: 0, terms: new Set<string>() };
      matches.set(path, entry);
    }
    entry.count += 1;
    entry.terms.add(term);
  };
  return {
    matches,
    read(text) {
      const lines = (pending + text).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) readLine(line);
    },
    end() {
      readLine(pending);
      pending = '';
    },
  };
}

export function parseMatches(output: string, patterns: readonly string[]) {
  const reader = matchReader(patterns);
  reader.read(output);
  reader.end();
  return reader.matches;
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
  const reader = matchReader(patterns);
  const decoder = new StringDecoder('utf8');
  await runCommand(rgPath, args, {
    cwd: root,
    okCodes: [0, 1, 2],
    onStdout: (chunk) => reader.read(decoder.write(chunk)),
    ...(signal ? { signal } : {}),
  });
  reader.read(decoder.end());
  reader.end();
  return reader.matches;
}
