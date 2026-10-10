export const REPO_GIT_CONFIG = '.git/config';
export const GLOBAL_GIT_CONFIG = 'global git config';
export const SYSTEM_GIT_CONFIG = 'system git config';

export type GitConfigPlace = 'repo' | 'global' | 'system' | 'file' | 'blob';

export interface GitConfigUse {
  writes: boolean;
  where: GitConfigPlace;
  file: string | null;
}

const FILE_FLAGS = new Set(['--file', '-f']);
const VALUE_FLAGS = new Set([
  ...FILE_FLAGS,
  '--blob',
  '--type',
  '-t',
  '--default',
  '--value',
  '--comment',
  '--url',
]);
const READ_FLAGS = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--get-color',
  '--get-colorbool',
  '--list',
  '-l',
]);
const WRITE_FLAGS = new Set([
  '--add',
  '--unset',
  '--unset-all',
  '--replace-all',
  '--rename-section',
  '--remove-section',
  '--edit',
  '-e',
]);
const OTHER_FLAGS = new Set([
  '--local',
  '--global',
  '--system',
  '--worktree',
  '--show-origin',
  '--show-scope',
  '--show-names',
  '--no-show-names',
  '--name-only',
  '--null',
  '-z',
  '--includes',
  '--no-includes',
  '--bool',
  '--int',
  '--bool-or-int',
  '--bool-or-str',
  '--path',
  '--expiry-date',
  '--no-type',
  '--fixed-value',
  '--all',
  '--regexp',
  '--append',
]);
const READ_VERBS = new Set(['get', 'list']);
const WRITE_VERBS = new Set(['set', 'unset', 'edit', 'rename-section', 'remove-section']);

interface ConfigShape {
  flags: string[];
  values: Map<string, string>;
  words: string[];
}

function shapeOf(args: readonly string[]): ConfigShape {
  const shape: ConfigShape = { flags: [], values: new Map(), words: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === '--') {
      shape.words.push(...args.slice(index + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      shape.words.push(token);
      continue;
    }
    const equals = token.startsWith('--') ? token.indexOf('=') : -1;
    const name = equals > 0 ? token.slice(0, equals) : token;
    shape.flags.push(name);
    if (!VALUE_FLAGS.has(name)) continue;
    if (equals > 0) shape.values.set(name, token.slice(equals + 1));
    else shape.values.set(name, args[(index += 1)] ?? '');
  }
  return shape;
}

function known(flag: string): boolean {
  return (
    VALUE_FLAGS.has(flag) || READ_FLAGS.has(flag) || WRITE_FLAGS.has(flag) || OTHER_FLAGS.has(flag)
  );
}

function onlyReads({ flags, words }: ConfigShape): boolean {
  if (!flags.every(known) || flags.some((flag) => WRITE_FLAGS.has(flag))) return false;
  const verb = words[0] ?? '';
  if (WRITE_VERBS.has(verb)) return false;
  if (READ_VERBS.has(verb) || flags.some((flag) => READ_FLAGS.has(flag))) return true;
  return words.length <= 1;
}

function fileOf(shape: ConfigShape): string | null {
  for (const flag of FILE_FLAGS) {
    const value = shape.values.get(flag);
    if (value !== undefined) return value;
  }
  return null;
}

function placeOf(shape: ConfigShape, file: string | null): GitConfigPlace {
  if (file !== null) return 'file';
  if (shape.flags.includes('--global')) return 'global';
  if (shape.flags.includes('--system')) return 'system';
  return shape.flags.includes('--blob') ? 'blob' : 'repo';
}

export function gitConfigUse(args: readonly string[]): GitConfigUse {
  const shape = shapeOf(args);
  const file = fileOf(shape);
  return { writes: !onlyReads(shape), where: placeOf(shape, file), file };
}
