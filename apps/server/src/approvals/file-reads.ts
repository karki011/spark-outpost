import path from 'node:path';
import { commandTree, findExecs, findRoots, type CommandTree } from './command-tree.ts';
import { programName, programTokens, resolveCommandPath } from './commands.ts';
import { globToRegExp } from '../projects/path-policy.ts';
import { plainRead, readArgs, type ReadArgs } from './read-args.ts';
import { codeConcern, worst, type Concern, type ReadPlace } from './read-concern.ts';
import { launchConcern } from './script-reads.ts';
import { inputTargets, redirectTargets } from './write-targets.ts';

type Loops = ReadonlyMap<string, readonly string[] | null>;

const GLOB = /[*?[{]/;
const UNKNOWN = /\$|`/;
const VARIABLE = /\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/;
const LOOPS = new Set(['for', 'select']);
const MAX_WORDS = 256;
const MAX_ROUNDS = 8;
const REASSIGNERS = new Set([
  'read',
  'export',
  'declare',
  'local',
  'typeset',
  'readonly',
  'mapfile',
  'readarray',
  'getopts',
  'printf',
  'unset',
]);
const UNSUPPORTED_GLOB = /[[{]/;
const isSubstitution = (word: string) => word.includes('$(') || word.includes('`');
const WALK_EVERYTHING: ReadArgs = { ...plainRead([]), recursive: true };
const PLAIN_READ = plainRead([]);

function assigns(command: string, name: string): boolean {
  return new RegExp(`(?:^|[^\\w$-])${name}\\+?=`).test(command);
}

function reassigned(tree: CommandTree, command: string, name: string): boolean {
  if (assigns(command, name)) return true;
  return tree.commands.some(
    (program) => REASSIGNERS.has(programName(program)) && program.slice(1).includes(name),
  );
}

function loopValues(tree: CommandTree, command: string): Loops {
  const loops = new Map<string, readonly string[] | null>();
  if (assigns(command, 'IFS')) return loops;
  for (const program of tree.commands) {
    if (!LOOPS.has(programName(program))) continue;
    const [, name, keyword, ...list] = program;
    if (!name) continue;
    const known =
      keyword === 'in' &&
      list.length > 0 &&
      !list.some(isSubstitution) &&
      /^[A-Za-z_]\w*$/.test(name) &&
      !reassigned(tree, command, name);
    const before = loops.get(name);
    loops.set(name, before === null || !known ? null : [...(before ?? []), ...list]);
  }
  return loops;
}

function variableValues(name: string, loops: Loops, place: ReadPlace): readonly string[] | null {
  if (name === 'HOME') return [place.home];
  if (name === 'PWD') return [place.cwd];
  return loops.get(name) ?? null;
}

function substituted(word: string, loops: Loops, place: ReadPlace): string[] | null {
  let words = [word];
  for (let round = 0; words.some((candidate) => VARIABLE.test(candidate)); round++) {
    if (round === MAX_ROUNDS) return null;
    const next: string[] = [];
    for (const candidate of words) {
      const match = VARIABLE.exec(candidate);
      if (!match) {
        next.push(candidate);
        continue;
      }
      const values = variableValues(match[1] ?? match[2]!, loops, place);
      if (!values) return null;
      const before = candidate.slice(0, match.index);
      const after = candidate.slice(match.index + match[0].length);
      next.push(...values.map((value) => `${before}${value}${after}`));
    }
    if (next.length > MAX_WORDS) return null;
    words = next;
  }
  return words.some((candidate) => UNKNOWN.test(candidate)) ? null : words;
}

function isHiddenBelow(root: string, file: string): boolean {
  return path
    .relative(root, file)
    .split(path.sep)
    .some((segment) => segment.startsWith('.') && segment !== '..');
}

function expanded(word: string, place: ReadPlace): string[] | null {
  if (!GLOB.test(word)) return [resolveCommandPath(word, place.cwd, place.home)];
  const pattern = word === '~' || word.startsWith('~/') ? `${place.home}${word.slice(1)}` : word;
  return place.files.glob(pattern, place.cwd);
}

function nameFilter(globs: readonly string[]): RegExp[] {
  return globs.filter((glob) => !UNSUPPORTED_GLOB.test(glob)).map(globToRegExp);
}

function filtersAllow(file: string, args: ReadArgs): boolean {
  const name = path.basename(file);
  const include = args.include.some((glob) => UNSUPPORTED_GLOB.test(glob))
    ? []
    : nameFilter(args.include);
  if (include.length > 0 && !include.some((pattern) => pattern.test(name))) return false;
  return !nameFilter(args.exclude).some((pattern) => pattern.test(name));
}

function walked(target: string, args: ReadArgs, place: ReadPlace): Concern {
  const files = place.files.walk(target);
  if (files === null) return 'unknown';
  const read = files.filter(
    (file) => (args.hidden || !isHiddenBelow(target, file)) && filtersAllow(file, args),
  );
  return read.some(place.isSecret) ? 'secret' : null;
}

function wordConcern(word: string, args: ReadArgs, place: ReadPlace): Concern {
  const targets = expanded(word, place);
  if (targets === null) return 'unknown';
  if (targets.some(place.isSecret)) return 'secret';
  if (!args.recursive) return null;
  return worst(targets.map((target) => walked(target, args, place)));
}

function fileConcern(word: string, args: ReadArgs, loops: Loops, place: ReadPlace): Concern {
  const words = substituted(word, loops, place);
  if (words === null) return 'unknown';
  return worst(words.map((candidate) => wordConcern(candidate, args, place)));
}

function findConcern(program: readonly string[], loops: Loops, place: ReadPlace): Concern {
  const args = program.slice(1);
  const execsRead = findExecs(args).some((exec) => readArgs(programTokens(exec)) !== null);
  if (!execsRead) return null;
  return worst(findRoots(args).map((root) => fileConcern(root, WALK_EVERYTHING, loops, place)));
}

interface ReadScan {
  command: string;
  tree: CommandTree;
  loops: Loops;
  redirects: ReadonlySet<string>;
  place: ReadPlace;
}

function programConcern(program: string[], scan: ReadScan): Concern {
  const { loops, place } = scan;
  if (programName(program) === 'find') return findConcern(program, loops, place);
  const args = readArgs(program);
  if (!args) return null;
  if (scan.tree.fedByXargs.includes(program)) return 'unknown';
  const files = args.files.filter((word) => !scan.redirects.has(word));
  return worst([
    ...args.code.map((text) => codeConcern(text, place)),
    ...files.map((word) => fileConcern(word, args, loops, place)),
  ]);
}

export function readConcern(
  command: string,
  tree: CommandTree,
  place: ReadPlace,
  depth = 0,
): Concern {
  const loops = loopValues(tree, command);
  const scan: ReadScan = { command, tree, loops, redirects: redirectTargets(command), place };
  const inputs = [...inputTargets(command)].map((word) =>
    fileConcern(word, PLAIN_READ, loops, place),
  );
  const shell = (script: string) => readConcern(script, commandTree(script), place, depth + 1);
  return worst([
    ...inputs,
    ...tree.commands.map((program) => programConcern(program, scan)),
    launchConcern(command, place, { depth, shell }),
  ]);
}
