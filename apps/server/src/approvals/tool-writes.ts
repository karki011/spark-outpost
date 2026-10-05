import path from 'node:path';
import { commandTree } from './command-tree.ts';
import { resolveCommandPath } from './commands.ts';

const LAUNCHERS = new Set(['npx', 'pnpm', 'npm', 'yarn', 'bun', 'bunx', 'exec', 'dlx', 'x']);
const FIX_FLAGS = new Set(['--fix', '--write', '--fix-dry-run=false']);
const SNAPSHOT_FLAGS = new Set(['-u', '--update', '--update-snapshots', '--updateSnapshot']);
const REWRITING_FLAGS = new Map<string, ReadonlySet<string>>([
  ['eslint', FIX_FLAGS],
  ['oxlint', FIX_FLAGS],
  ['stylelint', FIX_FLAGS],
  ['biome', FIX_FLAGS],
  ['prettier', FIX_FLAGS],
  ['vitest', SNAPSHOT_FLAGS],
  ['jest', SNAPSHOT_FLAGS],
  ['playwright', SNAPSHOT_FLAGS],
]);
const VERBS = new Set(['run', 'test', 'check', 'format', 'lint', 'watch', 'related']);
const HARMLESS_OUTPUT =
  /^(?:(?:.*\/)?node_modules\/\.(?:cache|vite|vitest)(?:\/|$)|(?:.*\/)?(?:coverage|\.vitest|\.nyc_output|\.turbo|\.nx\/cache|playwright-report|test-results)(?:\/|$)|(?:.*\/)?\.eslintcache$|.*\.tsbuildinfo$)/;

function toolOf(program: readonly string[]): { name: string; args: string[] } | null {
  let index = 0;
  while (index < program.length && LAUNCHERS.has(path.basename(program[index]!))) index += 1;
  const name = path.basename(program[index] ?? '');
  return REWRITING_FLAGS.has(name) ? { name, args: program.slice(index + 1) } : null;
}

function rewrites(program: readonly string[], cwd: string, home: string): string[] {
  const tool = toolOf(program);
  if (!tool) return [];
  const flags = REWRITING_FLAGS.get(tool.name)!;
  if (!tool.args.some((arg) => flags.has(arg))) return [];
  const operands = tool.args.filter((arg) => !arg.startsWith('-') && !VERBS.has(arg));
  const targets = operands.length > 0 ? operands : ['.'];
  return targets.map((target) => resolveCommandPath(target, cwd, home));
}

export function toolWriteTargets(command: string, cwd: string, home: string): string[] {
  return commandTree(command).commands.flatMap((program) => rewrites(program, cwd, home));
}

export function harmlessOutput(relative: string): boolean {
  return HARMLESS_OUTPUT.test(relative);
}
