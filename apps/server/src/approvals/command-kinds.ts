import path from 'node:path';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import {
  hasControlOperators,
  programTokens,
  resolveCommandPath,
  splitSimpleCommands,
} from './commands.ts';

const GLOB = /[*?[{]/;
const LISTERS = new Set(['ls', 'pwd', 'stat', 'tree', 'find', 'wc']);
const CONTENT_READERS = new Set(['cat', 'head', 'tail', 'grep', 'sed', 'git']);
const GIT_READS = new Set(['status', 'diff', 'log', 'show', 'branch']);
const GIT_BRANCH_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--all', '--list', '--show-current']);
const RECURSIVE_GREP = new Set(['-r', '-R', '--recursive', '--dereference-recursive']);
const FIND_ACTIONS = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
]);
const SED_PRINT = /^\d+(,\d+)?p$/;

export interface CommandPlace {
  cwd: string;
  home: string;
  inside: (target: string) => boolean;
}

const isFlag = (token: string) => token.startsWith('-');

export function grepRecurses(args: readonly string[]): boolean {
  return args.some((arg) => RECURSIVE_GREP.has(arg) || /^-[a-zA-Z]*[rR]/.test(arg));
}

function flagValue(token: string): string | null {
  const equals = token.indexOf('=');
  return token.startsWith('--') && equals > 0 ? token.slice(equals + 1) : null;
}

function argumentsAllowed(program: string, args: readonly string[]): boolean {
  switch (program) {
    case 'find':
      return !args.some((arg) => FIND_ACTIONS.has(arg));
    case 'tree':
      return !args.some((arg) => arg === '-o' || arg.startsWith('-o'));
    case 'grep':
      return !grepRecurses(args);
    case 'sed':
      return (
        args[0] === '-n' && SED_PRINT.test(args[1] ?? '') && args.slice(2).every((a) => !isFlag(a))
      );
    case 'git':
      return gitArgumentsAllowed(args);
    default:
      return true;
  }
}

function gitArgumentsAllowed(args: readonly string[]): boolean {
  const [subcommand, ...rest] = args;
  if (!subcommand || !GIT_READS.has(subcommand)) return false;
  if (rest.some((arg) => arg === '--output' || arg.startsWith('--output=') || arg.includes(':'))) {
    return false;
  }
  if (subcommand === 'branch') return rest.every((arg) => GIT_BRANCH_FLAGS.has(arg));
  return true;
}

function pathWords(program: string, args: readonly string[]): string[] {
  if (program === 'git') return args.slice(1).filter((arg) => !isFlag(arg) && arg !== '--');
  if (program === 'sed') return args.slice(2);
  const values = args.map(flagValue).filter((value): value is string => value !== null);
  return [...args.filter((arg) => !isFlag(arg)), ...values];
}

export function isSafeRead(command: string, place: CommandPlace): boolean {
  if (hasControlOperators(command)) return false;
  const commands = splitSimpleCommands(command);
  if (commands.length !== 1) return false;
  const tokens = commands[0]!;
  if (programTokens(tokens).length !== tokens.length) return false;
  const [program, ...args] = tokens;
  if (!program || program.includes('/')) return false;
  if (!LISTERS.has(program) && !CONTENT_READERS.has(program)) return false;
  if (!argumentsAllowed(program, args)) return false;
  if (CONTENT_READERS.has(program) && args.some((arg) => GLOB.test(arg))) return false;
  if (!place.inside(place.cwd)) return false;
  return pathWords(program, args).every((word) =>
    place.inside(resolveCommandPath(word, place.cwd, place.home)),
  );
}

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const JS_INSTALLS = new Set(['install', 'i', 'add', 'update', 'up', 'upgrade']);
const JS_OTHER_VERBS = new Set(['ci', 'run', 'exec', 'test', 'dlx', 'x', 'why', 'list', 'ls']);
const LOCKFILE_FLAGS = new Set(['--frozen-lockfile', '--immutable', '--offline']);
const PYTHONS = new Set(['python', 'python3']);
const PIPS = new Set(['pip', 'pip3']);
const INSTALL_VERBS: Record<string, ReadonlySet<string>> = {
  cargo: new Set(['add', 'install']),
  go: new Set(['get', 'install']),
  gem: new Set(['install']),
  brew: new Set(['install', 'reinstall', 'upgrade', 'tap']),
  apt: new Set(['install']),
  'apt-get': new Set(['install']),
  poetry: new Set(['add', 'install', 'update']),
  composer: new Set(['require', 'install', 'update']),
};

function positional(args: readonly string[]): string[] {
  return args.filter((arg) => !isFlag(arg));
}

function restoresLockfile(verb: string, rest: readonly string[]): boolean {
  if (verb !== 'install' && verb !== 'i') return false;
  return positional(rest).length === 0 && rest.some((arg) => LOCKFILE_FLAGS.has(arg));
}

function jsInstall(program: string, args: readonly string[]): boolean {
  const verbIndex = args.findIndex(
    (arg) => !isFlag(arg) && (JS_INSTALLS.has(arg) || JS_OTHER_VERBS.has(arg)),
  );
  if (verbIndex === -1) {
    const bareYarn = program === 'yarn' && positional(args).length === 0;
    return bareYarn && !args.some((arg) => LOCKFILE_FLAGS.has(arg));
  }
  const verb = args[verbIndex]!;
  if (!JS_INSTALLS.has(verb)) return false;
  return !restoresLockfile(verb, [...args.slice(0, verbIndex), ...args.slice(verbIndex + 1)]);
}

function pythonInstall(program: string, args: readonly string[]): boolean {
  if (PIPS.has(program)) return args.includes('install');
  if (PYTHONS.has(program))
    return args[0] === '-m' && PIPS.has(args[1] ?? '') && args.includes('install');
  if (program !== 'uv') return false;
  const verb = positional(args)[0];
  if (verb === 'add') return true;
  if (verb === 'pip') return args.includes('install');
  if (verb === 'sync') return !args.some((arg) => arg === '--frozen' || arg === '--locked');
  return false;
}

function bundleInstall(args: readonly string[]): boolean {
  const verb = positional(args)[0];
  if (verb === 'add') return true;
  if (verb !== 'install') return false;
  return !args.some((arg) => arg === '--frozen' || arg === '--deployment');
}

function isInstall(tokens: readonly string[]): boolean {
  const [first, ...args] = programTokens(tokens);
  if (!first) return false;
  const program = path.basename(first);
  if (PACKAGE_MANAGERS.has(program)) return jsInstall(program, args);
  if (program === 'bundle') return bundleInstall(args);
  if (PIPS.has(program) || PYTHONS.has(program) || program === 'uv') {
    return pythonInstall(program, args);
  }
  const verbs = INSTALL_VERBS[program];
  const verb = positional(args)[0];
  return verbs !== undefined && verb !== undefined && verbs.has(verb);
}

export function isPackageInstall(command: string): boolean {
  return splitSimpleCommands(command).some(isInstall);
}

const TEST_RUNNERS = [
  'node --test',
  'npm test',
  'npm run test',
  'pnpm test',
  'pnpm run test',
  'yarn test',
  'bun test',
  'pytest',
  'python -m pytest',
  'python3 -m pytest',
  'go test',
  'cargo test',
] as const;

export function testRunnerAllowlist(level: InvolvementLevel): readonly string[] {
  return level === 'balanced' ? [] : TEST_RUNNERS;
}
