import { resolveCommandPath } from './commands.ts';
import { gitSubcommands, type GitSub } from './git-commands.ts';
import { withTempVariable } from './temp-dirs.ts';

const ADD_VALUE_FLAGS = new Set(['-b', '-B', '--reason']);
const UNKNOWN_WORD = /\$|`/;

interface WorktreeUse {
  verb: string;
  path: string | null;
}

function operands(args: readonly string[]): string[] {
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (ADD_VALUE_FLAGS.has(arg)) index += 1;
    else if (!arg.startsWith('-')) words.push(arg);
  }
  return words;
}

function worktreeUse(sub: GitSub): WorktreeUse | null {
  if (sub.name !== 'worktree') return null;
  const [verb, ...args] = sub.rest;
  if (!verb) return null;
  const [target] = operands(args);
  return { verb, path: target === undefined ? null : withTempVariable(target) };
}

function uses(command: string): WorktreeUse[] {
  return gitSubcommands(command).flatMap((sub) => worktreeUse(sub) ?? []);
}

function targets(command: string, verb: string, cwd: string, home: string): string[] | null {
  const paths = uses(command).flatMap((use) => (use.verb === verb ? [use.path] : []));
  if (paths.some((target) => target === null || UNKNOWN_WORD.test(target))) return null;
  return paths.map((target) => resolveCommandPath(target!, cwd, home));
}

export function worktreeAdds(command: string, cwd: string, home: string): string[] | null {
  return targets(command, 'add', cwd, home);
}

export function worktreeRemoves(command: string, cwd: string, home: string): string[] | null {
  return targets(command, 'remove', cwd, home);
}
