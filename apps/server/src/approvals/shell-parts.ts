import path from 'node:path';
import { gitSubcommand } from './git-commands.ts';
import { inTempDir } from './request-place.ts';
import { LISTERS, readOperands } from './read-operands.ts';
import { DYNAMIC, type ShellCommand, type ShellRedirect, type ShellWord } from './shell-parse.ts';

export interface PartPlace {
  cwd: string;
  home: string;
  inside: (target: string) => boolean;
  isSecret: (target: string) => boolean;
}

const PLAIN_WORD = /^[\w@%+=:,./-]+$/;
const ECHOES = new Set([
  'echo',
  'printf',
  'true',
  'false',
  'test',
  '[',
  ':',
  'read',
  'basename',
  'dirname',
  'date',
  'uname',
  'whoami',
  'which',
  'type',
]);
const GIT_READS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'grep',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'blame',
  'describe',
  'shortlog',
  'rev-list',
  'merge-base',
  'for-each-ref',
  'cat-file',
  'show-ref',
  'name-rev',
]);
const GIT_LISTS: Readonly<Record<string, ReadonlySet<string>>> = {
  branch: new Set(['-a', '-r', '-v', '-vv', '--all', '--list', '--show-current', '--remotes']),
  tag: new Set(['-l', '--list', '-n']),
  remote: new Set(['-v', '--verbose']),
};
const GIT_LIST_VALUE = /^--(?:format|sort|contains|merged|no-merged|points-at)=/;
const GIT_SAFE_GLOBALS = new Set(['--no-pager', '-P', '--no-optional-locks']);
const GIT_REFUSED_ARGS = /^(?:--output|--ext-diff|-O|--open-files-in-pager|--textconv)(?:=|$)/;
const DYNAMIC_OK = new Set(['git', ...LISTERS]);

function quoted(text: string): string {
  if (text !== '' && PLAIN_WORD.test(text)) return text;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function dynamicQuoted(text: string): string {
  const escaped = text.replace(/["\\`$]/g, (char) => `\\${char}`);
  return `"${escaped.replaceAll(DYNAMIC, '$SPARK_UNKNOWN')}"`;
}

export function partText(command: ShellCommand): string {
  return command.words
    .map((word) => (word.dynamic ? dynamicQuoted(word.text) : quoted(word.text)))
    .join(' ');
}

function gitReads(args: readonly ShellWord[]): boolean {
  const texts = args.map((word) => word.text);
  const sub = gitSubcommand(texts);
  if (!sub) return false;
  const globals = texts.slice(0, texts.length - sub.rest.length - 1);
  if (!globals.every((flag) => GIT_SAFE_GLOBALS.has(flag))) return false;
  if (sub.rest.some((arg) => GIT_REFUSED_ARGS.test(arg))) return false;
  if (GIT_READS.has(sub.name)) return true;
  const listing = GIT_LISTS[sub.name];
  return (
    listing !== undefined && sub.rest.every((arg) => listing.has(arg) || GIT_LIST_VALUE.test(arg))
  );
}

function operandsSafe(
  program: string,
  byText: ReadonlyMap<string, ShellWord>,
  operands: readonly string[],
  place: PartPlace,
): boolean {
  return operands.every((operand) => {
    const word = byText.get(operand);
    if (word?.dynamic) return DYNAMIC_OK.has(program);
    if (word?.glob && !LISTERS.has(program)) return false;
    const target = resolvePart(operand, place);
    return place.inside(target) && !place.isSecret(target);
  });
}

function resolvePart(word: string, place: PartPlace): string {
  const expanded =
    word === '~' || word.startsWith('~/') ? path.join(place.home, word.slice(1)) : word;
  return path.resolve(place.cwd, expanded.split(/[*?[{]/)[0] || '.');
}

function readsOnly(command: ShellCommand, place: PartPlace): boolean {
  const [name, ...args] = command.words;
  if (!name || name.dynamic) return false;
  const program = name.text;
  if (ECHOES.has(program)) return true;
  if (program === 'cd' || program === 'pushd') {
    const target = args[0];
    return target !== undefined && !target.dynamic && place.inside(resolvePart(target.text, place));
  }
  if (program === 'git') {
    return gitReads(args) && args.every((word) => word.dynamic || !secretWord(word.text, place));
  }
  if (program === 'rg') return ripgrepReads(args, place);
  const texts = args.map((word) => word.text.replaceAll(DYNAMIC, '$'));
  const byText = new Map(texts.map((text, index) => [text, args[index]!]));
  const operands = readOperands(program, texts, command.piped);
  return operands !== null && operandsSafe(program, byText, operands, place);
}

const RG_UNSAFE =
  /^(?:--pre|--pre-glob|-z|--search-zip|-u+|--unrestricted|--no-ignore.*|--hidden|-\.|-L|--follow|-f|--file|--ignore-file)(?:=|$)/;

function ripgrepReads(args: readonly ShellWord[], place: PartPlace): boolean {
  if (args.some((word) => word.dynamic || RG_UNSAFE.test(word.text))) return false;
  const positional = args.filter((word) => !word.text.startsWith('-'));
  return positional.slice(1).every((word) => {
    const target = resolvePart(word.text, place);
    return place.inside(target) && !place.isSecret(target);
  });
}

function secretWord(text: string, place: PartPlace): boolean {
  const candidates = [text, text.slice(text.lastIndexOf(':') + 1)];
  return candidates.some(
    (candidate) =>
      candidate !== '' &&
      !candidate.startsWith('-') &&
      place.isSecret(resolvePart(candidate, place)),
  );
}

export function partReads(command: ShellCommand, place: PartPlace): boolean {
  return !command.assigns && readsOnly(command, place);
}

const QUIET_TARGETS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);
const DUPLICATES = /^\d*[<>]&$|^&>$/;

export type RedirectKind =
  'quiet' | 'reads' | 'writes_inside' | 'writes_temp' | 'writes_outside' | 'secret';

export function redirectKind(redirect: ShellRedirect, place: PartPlace): RedirectKind {
  const { operator, target } = redirect;
  if (target && !target.dynamic && QUIET_TARGETS.has(target.text)) return 'quiet';
  if (DUPLICATES.test(operator) && target && /^(?:\d+|-)$/.test(target.text)) return 'quiet';
  if (!target || target.dynamic) return operator.includes('<') ? 'secret' : 'writes_outside';
  const resolved = resolvePart(target.text, place);
  if (place.isSecret(resolved)) return 'secret';
  if (operator === '<') return place.inside(resolved) ? 'reads' : 'secret';
  if (place.inside(resolved)) return 'writes_inside';
  return inTempDir(resolved) ? 'writes_temp' : 'writes_outside';
}
