import path from 'node:path';
import {
  programTokens,
  resolveCommandPath,
  splitSimpleCommands,
  type SimpleCommand,
} from './commands.ts';
import { readPipeline } from './read-pipeline.ts';
import { LISTERS, readOperands } from './read-operands.ts';

const GLOB = /[*?[{]/;

export interface CommandPlace {
  cwd: string;
  home: string;
  inside: (target: string) => boolean;
}

const isFlag = (token: string) => token.startsWith('-');

function stageIsSafeRead({ tokens, stdin }: SimpleCommand, place: CommandPlace): boolean {
  if (programTokens(tokens).length !== tokens.length) return false;
  const [program, ...args] = tokens;
  if (!program || program.includes('/')) return false;
  const operands = readOperands(program, args, stdin === 'pipe');
  if (!operands) return false;
  if (!LISTERS.has(program) && operands.some((word) => GLOB.test(word))) return false;
  return operands.every((word) => place.inside(resolveCommandPath(word, place.cwd, place.home)));
}

export function isSafeRead(command: string, place: CommandPlace): boolean {
  if (!place.inside(place.cwd)) return false;
  const stages = readPipeline(command);
  return stages !== null && stages.every((stage) => stageIsSafeRead(stage, place));
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

export const TEST_RUNNER_ALLOWLIST: readonly string[] = [
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
];
