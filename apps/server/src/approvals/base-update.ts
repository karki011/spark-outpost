import { argumentWords, commandTree } from './command-tree.ts';

export interface BaseUpdate {
  base: string;
  rebase: boolean;
}

export type BaseUpdateVerdict = { kind: 'allow' } | { kind: 'refuse'; reason: string };

const PLAIN_COMMAND = /^(GIT_EDITOR=(true|:)\s+)?git\s+[^;&|`$<>()\\\n'"]+$/;
const MERGE_FLAGS = new Set(['--no-edit', '--no-ff', '--ff', '--ff-only']);
const PULL_FLAGS = new Set([
  '--no-edit',
  '--no-ff',
  '--ff',
  '--ff-only',
  '--no-rebase',
  '--rebase',
]);
const MERGE_CONTROLS = new Set(['--abort', '--continue', '--quit']);
const REBASE_CONTROLS = new Set(['--abort', '--continue', '--skip', '--quit']);
const ADD_FLAGS = new Set(['-u', '--update', '--']);
const UPDATES = new Set(['merge', 'pull', 'rebase', 'add']);

export function baseUpdateRefusal(base: string): string {
  return `This branch is already on the remote, so a rebase would need a force push, which publishing never does. Merge the base instead: git merge --no-edit origin/${base}`;
}

export function baseOnlyReason(base: string): string {
  return `This workflow step may update its branch only from ${base} (git pull origin ${base}, git merge origin/${base} or git rebase origin/${base}), one plain git command at a time`;
}

function words(command: string): string[] | null {
  if (!PLAIN_COMMAND.test(command.trim())) return null;
  const tree = commandTree(command);
  if (tree.opaque || tree.commands.length !== 1) return null;
  const program = tree.commands[0]!;
  return argumentWords(tree, program);
}

function split(rest: readonly string[]) {
  return {
    flags: rest.filter((word) => word.startsWith('-')),
    names: rest.filter((word) => !word.startsWith('-')),
  };
}

function isBase(ref: string, base: string): boolean {
  return ref === base || ref === `origin/${base}`;
}

function controlOnly(rest: readonly string[], controls: ReadonlySet<string>): boolean {
  return rest.length === 1 && controls.has(rest[0]!);
}

function merge(rest: readonly string[], update: BaseUpdate): boolean {
  if (controlOnly(rest, MERGE_CONTROLS)) return true;
  const { flags, names } = split(rest);
  return (
    flags.every((flag) => MERGE_FLAGS.has(flag)) &&
    names.length === 1 &&
    isBase(names[0]!, update.base)
  );
}

function pullRebases(flags: readonly string[]): boolean {
  return !flags.includes('--no-rebase') && !flags.includes('--ff-only');
}

function pull(rest: readonly string[], update: BaseUpdate): BaseUpdateVerdict | null {
  const { flags, names } = split(rest);
  if (!flags.every((flag) => PULL_FLAGS.has(flag))) return null;
  if (names.length !== 2 || names[0] !== 'origin' || names[1] !== update.base) return null;
  if (pullRebases(flags) && !update.rebase) {
    return { kind: 'refuse', reason: baseUpdateRefusal(update.base) };
  }
  return { kind: 'allow' };
}

function rebase(rest: readonly string[], update: BaseUpdate): BaseUpdateVerdict | null {
  if (controlOnly(rest, REBASE_CONTROLS)) return { kind: 'allow' };
  if (rest.length !== 1 || !isBase(rest[0]!, update.base)) return null;
  if (!update.rebase) return { kind: 'refuse', reason: baseUpdateRefusal(update.base) };
  return { kind: 'allow' };
}

function add(rest: readonly string[]): boolean {
  const { flags, names } = split(rest);
  if (!flags.every((flag) => ADD_FLAGS.has(flag))) return false;
  return names.every((name) => name !== '.' && !name.startsWith(':'));
}

function verdictFor(sub: string, rest: readonly string[], update: BaseUpdate) {
  if (sub === 'merge') return merge(rest, update) ? ({ kind: 'allow' } as const) : null;
  if (sub === 'pull') return pull(rest, update);
  if (sub === 'rebase') return rebase(rest, update);
  return add(rest) && rest.length > 0 ? ({ kind: 'allow' } as const) : null;
}

export function baseUpdateVerdict(
  command: string | null,
  update: BaseUpdate,
): BaseUpdateVerdict | null {
  if (!command) return null;
  const parsed = words(command);
  if (!parsed || parsed[0] !== 'git' || !UPDATES.has(parsed[1] ?? '')) return null;
  const verdict = verdictFor(parsed[1]!, parsed.slice(2), update);
  return verdict ?? { kind: 'refuse', reason: baseOnlyReason(update.base) };
}
