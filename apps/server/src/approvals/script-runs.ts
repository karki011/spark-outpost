import path from 'node:path';
import { SHELLS } from './command-tree.ts';

export type ScriptLanguage = 'code' | 'shell' | 'shebang';

export interface ScriptRun {
  word: string;
  language: ScriptLanguage;
}

interface Launcher {
  values: readonly string[];
  stops: (flag: string) => boolean;
  subcommands?: ReadonlySet<string>;
  runVerb?: string;
  fileOnly?: boolean;
}

type Args = readonly string[];

const PYTHON = /^python[\d.]*$/;

export function isPython(name: string): boolean {
  return PYTHON.test(name);
}

const SCRIPT_FILE = /[/\\]|\.[cm]?[jt]sx?$/;
const NODE_VALUES = [
  ...['-r', '--require', '--import', '--loader', '--experimental-loader', '--input-type'],
  ...['-C', '--conditions', '--env-file', '--env-file-if-exists', '--title', '--tsconfig'],
];
const NODE_STOPS = new Set([
  ...['-e', '--eval', '-p', '--print', '-c', '--check', '--test', '--run'],
  ...['-i', '--interactive', '-v', '--version', '-h', '--help'],
]);
const VERSION_OR_HELP = new Set(['-v', '-V', '--version', '-h', '--help']);
const stopsOn = (names: ReadonlySet<string>) => (flag: string) => names.has(flag);

const LAUNCHERS = new Map<string, Launcher>([
  [
    'python',
    {
      values: ['-W', '-X', '-Q'],
      stops: (flag) => /^-[a-zA-Z]*[cm]$/.test(flag) || VERSION_OR_HELP.has(flag),
    },
  ],
  ['node', { values: NODE_VALUES, stops: stopsOn(NODE_STOPS) }],
  ['tsx', { values: NODE_VALUES, stops: stopsOn(NODE_STOPS), runVerb: 'watch' }],
  ['ts-node', { values: NODE_VALUES, stops: stopsOn(NODE_STOPS) }],
  [
    'bun',
    {
      values: ['-r', '--preload', '--cwd', '--env-file', '--config', '-c'],
      stops: stopsOn(NODE_STOPS),
      runVerb: 'run',
      fileOnly: true,
      subcommands: new Set([
        ...['test', 'install', 'i', 'add', 'a', 'remove', 'rm', 'x', 'exec', 'create', 'init'],
        ...['build', 'pm', 'upgrade', 'update', 'link', 'unlink', 'repl', 'outdated', 'publish'],
      ]),
    },
  ],
  [
    'deno',
    {
      values: ['-c', '--config', '--import-map', '-L', '--log-level', '--lock', '--cert'],
      stops: stopsOn(VERSION_OR_HELP),
      runVerb: 'run',
      fileOnly: true,
      subcommands: new Set([
        ...['test', 'fmt', 'lint', 'task', 'install', 'uninstall', 'compile', 'bench', 'check'],
        ...['doc', 'info', 'repl', 'eval', 'upgrade', 'add', 'remove', 'init', 'cache', 'jupyter'],
      ]),
    },
  ],
  [
    'ruby',
    {
      values: ['-I', '-r', '-C', '-F', '-E'],
      stops: (flag) => /^-[a-zA-Z]*[ec]$/.test(flag) || VERSION_OR_HELP.has(flag),
    },
  ],
  [
    'perl',
    {
      values: ['-I', '-m', '-M'],
      stops: (flag) => /^-[a-zA-Z]*[eEc]$/.test(flag) || VERSION_OR_HELP.has(flag),
    },
  ],
  [
    'php',
    {
      values: ['-c', '-d', '-t'],
      stops: (flag) => ['-r', '-l', '-S', '-a'].includes(flag) || VERSION_OR_HELP.has(flag),
    },
  ],
]);

const SHELL_LAUNCHER: Launcher = {
  values: ['-o', '+o', '-O', '+O', '--rcfile', '--init-file'],
  stops: (flag) => /^-[a-z]*[cs][a-z]*$/.test(flag) || VERSION_OR_HELP.has(flag),
};

const PACKAGE_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const EXEC_VERBS = new Set(['exec', 'dlx']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const TASK_RUNNERS = new Set(['uv', 'poetry', 'pipenv', 'rye', 'hatch', 'pdm']);
const TASK_RUNNER_VALUES = [
  ...['--with', '--python', '-p', '--project', '--directory', '--extra', '--group'],
  ...['--package', '--index', '-w', '-e', '--env'],
];

function operandAt(args: Args, launcher: Launcher): number | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--') return index + 1 < args.length ? index + 1 : null;
    if (arg === '-') return null;
    if (!arg.startsWith('-') && !arg.startsWith('+')) return index;
    const flag = arg.split('=')[0]!;
    if (launcher.stops(flag)) return null;
    if (launcher.values.includes(flag) && !arg.includes('=')) index++;
  }
  return null;
}

function operand(args: Args, launcher: Launcher): string | null {
  const at = operandAt(args, launcher);
  return at === null ? null : args[at]!;
}

function launched(language: ScriptLanguage, launcher: Launcher, args: Args): ScriptRun | null {
  const at = operandAt(args, launcher);
  if (at === null) return null;
  const first = args[at]!;
  if (launcher.subcommands?.has(first)) return null;
  const word = first === launcher.runVerb ? operand(args.slice(at + 1), launcher) : first;
  if (word === null) return null;
  if (launcher.fileOnly && !SCRIPT_FILE.test(word) && !/^https?:/.test(word)) return null;
  return { word, language };
}

function afterFlags(args: Args, values: readonly string[]): string[] {
  let index = 0;
  while (index < args.length && args[index]!.startsWith('-')) {
    index += values.includes(args[index]!) ? 2 : 1;
  }
  return args.slice(index);
}

function viaRunner(name: string, args: Args): ScriptRun | null {
  if (PACKAGE_RUNNERS.has(name)) return scriptRun(afterFlags(args, ['-p', '--package']));
  const verb = args.findIndex((arg) => !arg.startsWith('-'));
  if (verb === -1) return null;
  const rest = args.slice(verb + 1);
  if (PACKAGE_MANAGERS.has(name) && EXEC_VERBS.has(args[verb]!)) {
    return scriptRun(afterFlags(rest, []));
  }
  if (TASK_RUNNERS.has(name) && args[verb] === 'run') {
    const command = afterFlags(rest, TASK_RUNNER_VALUES);
    const pythonFile = command[0]?.endsWith('.py') === true;
    return scriptRun(pythonFile ? ['python', ...command] : command);
  }
  return null;
}

export function scriptRun(program: Args): ScriptRun | null {
  const first = program[0];
  if (!first) return null;
  const name = path.basename(first);
  const args = program.slice(1);
  if (name === 'source' || name === '.') {
    return args[0] ? { word: args[0], language: 'shell' } : null;
  }
  if (SHELLS.has(name)) return launched('shell', SHELL_LAUNCHER, args);
  const launcher = LAUNCHERS.get(PYTHON.test(name) ? 'python' : name);
  if (launcher) return launched('code', launcher, args);
  const runner = viaRunner(name, args);
  if (runner) return runner;
  return first.includes('/') ? { word: first, language: 'shebang' } : null;
}
