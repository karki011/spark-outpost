import { programName, resolveCommandPath, splitCommandLine, unwrapCommand } from './commands.ts';

export interface CommandTree {
  commands: string[][];
  opaque: boolean;
  fedByXargs: string[][];
  stdinFrom: Map<string[], string[] | null>;
  fragments: string[][];
}

const MAX_NESTING = 3;
const MAX_DIRS = 16;
export const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash']);
const FIND_EXECS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const FIND_EXEC_ENDS = new Set([';', '+']);
const FIND_LEADING_OPTION = /^-(?:[HLP]|O\d*)$/;
const SHELL_SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/;
const STDIN_SCRIPT_FLAG = /^-[a-z]*s[a-z]*$/;
const UNKNOWN_WORD = /\$|`/;

function hidesCommands(script: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < script.length; index++) {
    const char = script[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
    } else if (char === '\\') {
      index++;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '`' || (char === '$' && script[index + 1] === '(')) return true;
    } else if (char === '"' || char === "'") {
      quote = char;
    }
  }
  return quote !== null;
}

export function findRoots(args: readonly string[]): string[] {
  let index = 0;
  while (index < args.length && FIND_LEADING_OPTION.test(args[index]!)) index++;
  const roots: string[] = [];
  for (; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith('-') || arg === '(' || arg === '!') break;
    roots.push(arg);
  }
  return roots.length > 0 ? roots : ['.'];
}

export function findExecs(args: readonly string[]): string[][] {
  const roots = findRoots(args);
  const execs: string[][] = [];
  for (let index = 0; index < args.length; index++) {
    if (!FIND_EXECS.has(args[index]!)) continue;
    const end = args.findIndex((arg, at) => at > index && FIND_EXEC_ENDS.has(arg));
    const stop = end === -1 ? args.length : end;
    const exec = args
      .slice(index + 1, stop)
      .flatMap((arg) =>
        arg.includes('{}') ? roots.map((root) => arg.replaceAll('{}', root)) : [arg],
      );
    execs.push(exec);
    index = stop;
  }
  return execs;
}

function addShell(tree: CommandTree, program: readonly string[], depth: number): void {
  const flag = program.findIndex((token, index) => index > 0 && SHELL_SCRIPT_FLAG.test(token));
  if (flag > 0) {
    const script = program[flag + 1];
    if (script === undefined) tree.opaque = true;
    else addScript(tree, script, depth + 1);
    return;
  }
  const readsStdin = program.some((token, index) => index > 0 && STDIN_SCRIPT_FLAG.test(token));
  if (readsStdin || program.slice(1).every((token) => token.startsWith('-'))) tree.opaque = true;
}

function addCommand(tree: CommandTree, tokens: readonly string[], depth: number): string[] | null {
  if (depth > MAX_NESTING) {
    tree.opaque = true;
    return null;
  }
  const { program, wrappers, splitsString } = unwrapCommand(tokens);
  if (splitsString) tree.opaque = true;
  const name = programName(program);
  if (name === '') return null;
  tree.commands.push(program);
  if (wrappers.includes('xargs')) tree.fedByXargs.push(program);
  if (UNKNOWN_WORD.test(program[0]!)) tree.opaque = true;
  const runsCode = DELETERS.has(name) || SHELLS.has(name) || name === 'eval';
  if (wrappers.includes('xargs') && runsCode) tree.opaque = true;
  if (SHELLS.has(name)) addShell(tree, program, depth);
  else if (name === 'eval') addScript(tree, program.slice(1).join(' '), depth + 1);
  else if (name === 'find') {
    for (const exec of findExecs(program.slice(1))) addCommand(tree, exec, depth + 1);
  }
  return program;
}

function addScript(tree: CommandTree, script: string, depth: number): void {
  if (depth > MAX_NESTING || hidesCommands(script)) {
    tree.opaque = true;
    return;
  }
  let previous: string[] | null = null;
  for (const { tokens, stdin, fragment } of splitCommandLine(script)) {
    const program = addCommand(tree, tokens, depth);
    if (program && stdin) tree.stdinFrom.set(program, stdin === 'pipe' ? previous : null);
    if (program && fragment) tree.fragments.push(program);
    previous = program;
  }
}

export function commandTree(command: string): CommandTree {
  const tree: CommandTree = {
    commands: [],
    opaque: false,
    fedByXargs: [],
    stdinFrom: new Map(),
    fragments: [],
  };
  addScript(tree, command, 0);
  return tree;
}

export function treeWords(tree: CommandTree): string[] {
  return tree.commands.flat();
}

function deletedWords(program: readonly string[]): string[] {
  const name = programName(program);
  const args = program.slice(1);
  if (DELETERS.has(name)) return args.filter((arg) => !arg.startsWith('-'));
  if (name === 'find' && args.includes('-delete')) return findRoots(args);
  return [];
}

function changedDirs(program: readonly string[], dirs: string[], home: string): string[] | null {
  const target = program.slice(1).find((arg) => arg === '-' || !arg.startsWith('-'));
  if (target === '-' || (target !== undefined && UNKNOWN_WORD.test(target))) return null;
  const next =
    target === undefined ? [home] : dirs.map((dir) => resolveCommandPath(target, dir, home));
  const all = [...new Set([...dirs, ...next])];
  return all.length > MAX_DIRS ? null : all;
}

export function commandDirs(tree: CommandTree, cwd: string, home: string): string[] | null {
  let dirs: string[] | null = [cwd];
  for (const program of tree.commands) {
    const name = programName(program);
    if (name === 'cd' || name === 'pushd') dirs = changedDirs(program, dirs, home);
    if (dirs === null) return null;
  }
  return dirs;
}

export function deleteTargets(tree: CommandTree, cwd: string, home: string): string[] | null {
  let dirs = [cwd];
  const targets: string[] = [];
  for (const program of tree.commands) {
    const name = programName(program);
    if (name === 'cd' || name === 'pushd') {
      const next = changedDirs(program, dirs, home);
      if (next === null) return null;
      dirs = next;
      continue;
    }
    if (DELETERS.has(name) && tree.fedByXargs.includes(program)) return null;
    const words = deletedWords(program);
    if (words.some((word) => UNKNOWN_WORD.test(word))) return null;
    for (const word of words) {
      for (const dir of dirs) targets.push(resolveCommandPath(word, dir, home));
    }
  }
  return targets;
}
