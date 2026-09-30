import { commandTree, SHELLS } from './command-tree.ts';
import { programName, resolveCommandPath } from './commands.ts';
import { withoutHereText } from './inline-code.ts';

const UNKNOWN_WORD = /\$|`/;
const REDIRECT = /(?:^|[^<>&\d])\d?>>?(?!&)\s*([^\s;&|<>()]+)/g;
const REDIRECT_OPERATOR = /(?:^|[^<>&\d])\d?>>?(?!&)/g;
const INPUT_OPERATOR = /(?:^|[^<])\d?<(?![<(&>])/g;
const REDIRECT_TARGET = /^\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|<>()]+))/;
const INPUT = /<\s*([^\s;&|<>()]+)/g;
const DISCARDED = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);
const WRITERS = new Set(['touch', 'tee', 'rm', 'rmdir', 'unlink', 'mv', 'cp', 'truncate']);
const IN_PLACE = /^-(?:i|I)|^--in-place/;

function unquoted(script: string): string {
  return script.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (quoted) => ' '.repeat(quoted.length));
}

function redirectWords(script: string): string[] {
  return [...unquoted(script).matchAll(REDIRECT)]
    .map((match) => match[1]!)
    .filter((word) => !DISCARDED.has(word));
}

function inputWords(script: string): Set<string> {
  return new Set([...unquoted(script).matchAll(INPUT)].map((match) => match[1]!));
}

function operands(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-'));
}

function sedFiles(args: readonly string[]): string[] {
  if (!args.some((arg) => IN_PLACE.test(arg))) return [];
  const scripted = args.some((arg) => arg === '-e' || arg === '-f');
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '-e' || arg === '-f') {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) words.push(arg);
  }
  return scripted ? words : words.slice(1);
}

function programWords(program: readonly string[]): string[] {
  const name = programName(program);
  const args = program.slice(1);
  if (name === 'sed') return sedFiles(args);
  if (name === 'cp') return operands(args).slice(-1);
  if (WRITERS.has(name)) return operands(args);
  return [];
}

function scripts(command: string): string[] {
  const nested = commandTree(command).commands.flatMap((program) => {
    if (!SHELLS.has(programName(program))) return [];
    const flag = program.findIndex((token, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(token));
    const script = flag > 0 ? program[flag + 1] : undefined;
    return script ? [script] : [];
  });
  return [command, ...nested];
}

function operatorTargets(command: string, operator: RegExp): Set<string> {
  const targets = new Set<string>();
  for (const script of scripts(command)) {
    for (const match of unquoted(script).matchAll(operator)) {
      const target = REDIRECT_TARGET.exec(script.slice(match.index + match[0].length));
      if (target) targets.add(target[1] ?? target[2] ?? target[3]!);
    }
  }
  return targets;
}

export function redirectTargets(command: string): Set<string> {
  return operatorTargets(command, REDIRECT_OPERATOR);
}

export function inputTargets(command: string): Set<string> {
  return operatorTargets(command, INPUT_OPERATOR);
}

export function writeTargets(written: string, cwd: string, home: string): string[] | null {
  const command = withoutHereText(written);
  const tree = commandTree(command);
  if (tree.opaque) return null;
  const all = scripts(command);
  const inputs = new Set(all.flatMap((script) => [...inputWords(script)]));
  const words = [
    ...all.flatMap(redirectWords),
    ...tree.commands.flatMap(programWords).filter((word) => !inputs.has(word)),
  ];
  if (words.some((word) => UNKNOWN_WORD.test(word))) return null;
  return [...new Set(words.map((word) => resolveCommandPath(word, cwd, home)))];
}
