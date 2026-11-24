import { commandDirs, commandTree, findRoots } from './command-tree.ts';
import { programName, resolveCommandPath } from './commands.ts';
import { withoutHereText } from './inline-code.ts';
import { withTempVariable } from './temp-dirs.ts';
import { redirectTargets } from './write-targets.ts';

export interface GitControlWrites {
  targets: string[];
  unknown: boolean;
}

const LAST_IS_DESTINATION = new Set(['cp', 'install', 'ln', 'rsync']);
const ALL_WRITTEN = new Set(['mv', 'rm', 'rmdir', 'unlink', 'shred', 'touch', 'tee', 'truncate']);
const WRITERS = new Set([...LAST_IS_DESTINATION, ...ALL_WRITTEN, 'tar', 'dd']);
const TARGET_DIRECTORY = /^--target-directory=(.+)$/;
const TAR_DIRECTORY = /^--directory=(.+)$/;
const TAR_EXTRACTS = /^(?:--extract|--get|-[A-Za-z]*x[A-Za-z]*|[A-Za-z]*x[A-Za-z]*)$/;
const REMOTE_PATH = /^[^/]*:/;
const UNKNOWN_WORD = /\$|`|\{\}/;
const GLOB = /[*?[{]/;
const NAMES_GIT_FOLDER = /(?:^|[\s'"=:/\\])\.git(?:$|[\s'"/\\;&|)])/i;
const FINDS_GIT_FOLDER = /--(?:absolute-)?git-(?:dir|common-dir|path)\b|\bGIT_(?:DIR|COMMON_DIR)\b/;

function operands(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-'));
}

function targetDirectories(args: readonly string[]): string[] {
  const dirs: string[] = [];
  args.forEach((arg, index) => {
    if (arg === '-t' && args[index + 1] !== undefined) dirs.push(args[index + 1]!);
    else if (/^-t./.test(arg)) dirs.push(arg.slice(2));
    const long = TARGET_DIRECTORY.exec(arg);
    if (long) dirs.push(long[1]!);
  });
  return dirs;
}

function tarDirectories(args: readonly string[]): string[] {
  const extracting = args.some(
    (arg, index) => TAR_EXTRACTS.test(arg) && (index === 0 || arg.startsWith('-')),
  );
  if (!extracting) return [];
  const dirs: string[] = [];
  args.forEach((arg, index) => {
    const next = args[index + 1];
    if ((arg === '-C' || arg === '--directory') && next !== undefined) dirs.push(next);
    else if (/^-C./.test(arg)) dirs.push(arg.slice(2));
    const long = TAR_DIRECTORY.exec(arg);
    if (long) dirs.push(long[1]!);
  });
  return dirs;
}

function destinationWords(name: string, args: readonly string[]): string[] {
  const words = operands(args);
  const last = words.at(-1);
  const remote = name === 'rsync' && last !== undefined && REMOTE_PATH.test(last);
  return [...targetDirectories(args), ...(last === undefined || remote ? [] : [last])];
}

function writtenWords(program: readonly string[]): string[] {
  const name = programName(program);
  const args = program.slice(1);
  if (name === 'mv') return [...targetDirectories(args), ...operands(args)];
  if (LAST_IS_DESTINATION.has(name)) return destinationWords(name, args);
  if (ALL_WRITTEN.has(name)) return operands(args);
  if (name === 'tar') return tarDirectories(args);
  if (name === 'dd') return args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice(3));
  if (name === 'find' && args.includes('-delete')) return findRoots(args);
  return [];
}

function uncertain(word: string): boolean {
  return UNKNOWN_WORD.test(word) || (GLOB.test(word) && NAMES_GIT_FOLDER.test(` ${word}`));
}

function anchored(word: string): boolean {
  return word.startsWith('/') || word === '~' || word.startsWith('~/');
}

export function gitControlWrites(written: string, cwd: string, home: string): GitControlWrites {
  const command = withoutHereText(written);
  const tree = commandTree(command);
  const namesGit = NAMES_GIT_FOLDER.test(command) || FINDS_GIT_FOLDER.test(command);
  const words = [...tree.commands.flatMap(writtenWords), ...redirectTargets(command)].map(
    withTempVariable,
  );
  const dirs = commandDirs(tree, cwd, home);
  const unknown =
    namesGit &&
    (tree.opaque ||
      tree.fedByXargs.some((program) => WRITERS.has(programName(program))) ||
      words.some(uncertain) ||
      (dirs === null && !words.every(anchored)));
  const targets = words.flatMap((word) =>
    (dirs ?? [cwd]).map((dir) => resolveCommandPath(word, dir, home)),
  );
  return { targets: [...new Set(targets)], unknown };
}
