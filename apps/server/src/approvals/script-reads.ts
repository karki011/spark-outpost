import { commandDirs, commandTree, type CommandTree } from './command-tree.ts';
import { programName, resolveCommandPath } from './commands.ts';
import { heredocBodies, herestrings, withoutHereText } from './inline-code.ts';
import { readArgs } from './read-args.ts';
import { codeConcern, worst, type Concern, type ReadPlace } from './read-concern.ts';
import { scriptRun, type ScriptLanguage, type ScriptRun } from './script-runs.ts';
import { inputTargets, writeTargets } from './write-targets.ts';

export interface LaunchDepth {
  depth: number;
  shell: (script: string) => Concern;
}

interface Launch extends LaunchDepth {
  command: string;
  clean: string;
  tree: CommandTree;
  dirs: readonly string[] | null;
  place: ReadPlace;
}

type Found = Concern | 'missing';

const MAX_SCRIPT_DEPTH = 2;
const UNKNOWN = /\$|`/;
const GLOB = /[*?[{]/;
const REMOTE = /^[a-z]+:\/\//i;
const COMMENT_LINE = /^\s*#/;
const SHELL_SHEBANG = /^#!.*\b(?:ba|z|da|k|fi)?sh\b/;
const PROCESS_SUBSTITUTION = /<\(/;
const ECHOES = new Set(['echo', 'printf']);
const ECHO_FLAG = /^-[neE]+$/;
const FILE_FEEDERS = new Set(['cat', 'head', 'tail']);
const ENV_FILE_FLAGS = ['--env-file', '--env-file-if-exists'];
const ENV_FILE_RUNTIMES = new Set(['node', 'bun', 'deno', 'tsx', 'ts-node']);
const CANNOT_CREATE = new Set([
  ...['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'sleep', 'true', 'false'],
  ...['echo', 'printf', 'pwd', 'ls', 'which', 'type', 'command'],
]);

function secretWord(word: string, place: ReadPlace): boolean {
  if (word === '' || word.startsWith('-')) return false;
  return place.isSecret(resolveCommandPath(word, place.cwd, place.home));
}

function secretInScript(word: string, place: ReadPlace): boolean {
  if (!secretWord(word, place)) return false;
  place.inCode?.([resolveCommandPath(word, place.cwd, place.home)]);
  return true;
}

function loadsSecretEnv(program: readonly string[], place: ReadPlace): boolean {
  if (!ENV_FILE_RUNTIMES.has(programName(program))) return false;
  return program.some((arg, index) => {
    const [flag, inline] = arg.split(/=(.*)/s);
    if (!ENV_FILE_FLAGS.includes(flag!)) return false;
    const value = inline ?? program[index + 1];
    return value !== undefined && secretWord(value, place);
  });
}

function shellConcern(text: string, launch: Launch): Concern {
  if (launch.depth >= MAX_SCRIPT_DEPTH) return 'unknown';
  const script = text
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
  const tree = commandTree(script);
  if (tree.opaque) return 'unknown';
  if (tree.commands.flat().some((word) => secretInScript(word, launch.place))) return 'secret';
  return launch.shell(script);
}

function textConcern(text: string, language: 'code' | 'shell', launch: Launch): Concern {
  return language === 'shell' ? shellConcern(text, launch) : codeConcern(text, launch.place);
}

function shebangConcern(text: string | null, launch: Launch): Concern {
  if (text === null || text.includes('\0')) return null;
  const shell = SHELL_SHEBANG.test(text) || !text.startsWith('#!');
  return textConcern(text, shell ? 'shell' : 'code', launch);
}

function writtenHere(file: string, launch: Launch): boolean {
  const written = writeTargets(launch.command, launch.place.cwd, launch.place.home);
  return written?.includes(file) ?? false;
}

function fileConcern(
  file: string,
  language: ScriptLanguage,
  launch: Launch,
  secretEnv: boolean,
): Found {
  const kind = language === 'shell' ? 'shell' : 'code';
  if (writtenHere(file, launch)) {
    const bodies = heredocBodies(launch.command);
    if (bodies.length === 0) return 'hidden';
    if (secretEnv) return 'secret';
    return worst(bodies.map((body) => textConcern(body, kind, launch)));
  }
  const script = launch.place.files.script(file);
  if (!script) return 'missing';
  if (script.committed) return null;
  if (secretEnv) return 'secret';
  if (language === 'shebang') return shebangConcern(script.text, launch);
  if (script.text === null || script.text.includes('\0')) return 'hidden';
  return textConcern(script.text, kind, launch);
}

function createdEarlier(program: readonly string[], launch: Launch): boolean {
  const index = launch.tree.commands.indexOf(program as string[]);
  const before = index === -1 ? launch.tree.commands : launch.tree.commands.slice(0, index);
  return before.some((earlier) => !CANNOT_CREATE.has(programName(earlier)));
}

function scriptConcern(
  run: ScriptRun,
  program: readonly string[],
  launch: Launch,
  secretEnv: boolean,
): Concern {
  if (REMOTE.test(run.word)) return 'hidden';
  if (UNKNOWN.test(run.word) || GLOB.test(run.word) || launch.dirs === null) return 'unknown';
  const { home } = launch.place;
  const files = new Set(launch.dirs.map((dir) => resolveCommandPath(run.word, dir, home)));
  const found = [...files]
    .map((file) => fileConcern(file, run.language, launch, secretEnv))
    .filter((concern): concern is Concern => concern !== 'missing');
  if (found.length > 0) return worst(found);
  return createdEarlier(program, launch) ? 'hidden' : null;
}

function hereConcern(launch: Launch): Concern | undefined {
  const bodies = [...heredocBodies(launch.command), ...herestrings(launch.command)];
  if (bodies.length === 0) return undefined;
  return worst(bodies.map((body) => codeConcern(body, launch.place)));
}

function pipedConcern(producer: readonly string[], launch: Launch): Concern {
  const name = programName(producer);
  const args = producer.slice(1);
  if (ECHOES.has(name)) {
    const text = args.filter((arg) => !ECHO_FLAG.test(arg)).join(' ');
    return UNKNOWN.test(text) ? 'hidden' : codeConcern(text, launch.place);
  }
  if (!FILE_FEEDERS.has(name)) return 'hidden';
  const files = readArgs(producer)?.files ?? [];
  if (files.length === 0) return hereConcern(launch) ?? 'hidden';
  const runs = files.map((word) => ({ word, language: 'code' as const }));
  return worst(runs.map((run) => scriptConcern(run, producer, launch, false)));
}

function stdinConcern(program: string[], launch: Launch): Concern {
  if (launch.tree.stdinFrom.has(program)) {
    const producer = launch.tree.stdinFrom.get(program);
    return producer ? pipedConcern(producer, launch) : 'hidden';
  }
  const here = hereConcern(launch);
  if (here !== undefined) return here;
  const inputs = [...inputTargets(launch.clean)].map((word) => ({
    word,
    language: 'code' as const,
  }));
  if (inputs.length > 0) {
    return worst(inputs.map((run) => scriptConcern(run, program, launch, false)));
  }
  return PROCESS_SUBSTITUTION.test(launch.clean) ? 'hidden' : null;
}

function programConcern(program: string[], launch: Launch): Concern {
  const { fedByXargs, fragments } = launch.tree;
  if (fedByXargs.includes(program) || fragments.includes(program)) return null;
  const run = scriptRun(program);
  const args = readArgs(program);
  const secretEnv = loadsSecretEnv(program, launch.place);
  const runsInline = (args?.code.length ?? 0) > 0 || args?.stdinCode === true;
  return worst([
    run ? scriptConcern(run, program, launch, secretEnv) : null,
    args?.stdinCode ? stdinConcern(program, launch) : null,
    secretEnv && runsInline ? 'secret' : null,
  ]);
}

export function launchConcern(command: string, place: ReadPlace, depth: LaunchDepth): Concern {
  const clean = withoutHereText(command);
  const tree = commandTree(clean);
  const dirs = commandDirs(tree, place.cwd, place.home);
  const launch: Launch = { ...depth, command, clean, tree, dirs, place };
  return worst(tree.commands.map((program) => programConcern(program, launch)));
}
