import path from 'node:path';

const CONTROL_OPERATORS = /[;&|\n]|\$\(|`|[<>]/;
const SEPARATORS = new Set([';', '&', '|', '\n']);
const REDIRECTS = new Set(['<', '>']);
const WRAPPER_VALUE_FLAGS = new Map<string, ReadonlySet<string>>([
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '--user', '--group'])],
  ['doas', new Set(['-u', '-C'])],
  ['command', new Set()],
  ['exec', new Set(['-a'])],
  ['nohup', new Set()],
  ['time', new Set()],
  ['env', new Set(['-u', '-C', '--unset', '--chdir'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['ionice', new Set(['-c', '-n', '--class', '--classdata'])],
  ['timeout', new Set(['-s', '-k', '--signal', '--kill-after'])],
  ['stdbuf', new Set(['-i', '-o', '-e', '--input', '--output', '--error'])],
  ['caffeinate', new Set(['-t', '-w'])],
  ['xargs', new Set(['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a', '--max-args', '--max-procs'])],
]);
const WRAPPER_OPERANDS = new Map([['timeout', 1]]);
const ENV_SPLIT = /^(?:-S|--split-string)/;
export const COMMAND_WRAPPERS: ReadonlySet<string> = new Set(WRAPPER_VALUE_FLAGS.keys());
const SUBSTITUTION = '$(';
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{']);

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function hasControlOperators(command: string): boolean {
  return CONTROL_OPERATORS.test(command);
}

function isRedirectAmpersand(command: string, index: number): boolean {
  const before = command[index - 1];
  return before === '>' || before === '<' || command[index + 1] === '>';
}

export type StdinFrom = 'pipe' | 'group' | null;

export interface SimpleCommand {
  tokens: string[];
  stdin: StdinFrom;
  fragment: boolean;
}

export function splitCommandLine(command: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  let inBackticks = false;
  let piped: StdinFrom = null;
  let closedGroup = false;
  let fragment = false;
  const endToken = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length > 0) {
      commands.push({ tokens, stdin: piped, fragment });
      piped = null;
      closedGroup = false;
      fragment = false;
    }
    tokens = [];
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        current += command[++index];
      } else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < command.length) {
      current += command[++index];
      started = true;
    } else if (char === '`' || (char === '$' && command[index + 1] === '(')) {
      const opens = char === '$' || !inBackticks;
      if (char === '`') inBackticks = !inBackticks;
      else index++;
      if (opens) {
        current += SUBSTITUTION;
        started = true;
      }
      endCommand();
      closedGroup = !opens;
      fragment = !opens;
    } else if (char === '&' && isRedirectAmpersand(command, index)) {
      endToken();
    } else if (char === '|') {
      endCommand();
      fragment = false;
      if (command[index + 1] === '|') {
        index++;
        piped = null;
      } else piped = closedGroup ? 'group' : 'pipe';
    } else if (SEPARATORS.has(char) || char === '(' || char === ')') {
      endCommand();
      closedGroup = char === ')';
      fragment = char === ')';
    } else if (REDIRECTS.has(char)) {
      endToken();
    } else if (/\s/.test(char)) {
      endToken();
    } else {
      current += char;
      started = true;
    }
  }
  endCommand();
  return commands;
}

export function splitSimpleCommands(command: string): string[][] {
  return splitCommandLine(command).map((simple) => simple.tokens);
}

export function programName(program: readonly string[]): string {
  return path.basename(program[0] ?? '');
}

export interface Unwrapped {
  program: string[];
  wrappers: string[];
  splitsString: boolean;
}

export function unwrapCommand(tokens: readonly string[]): Unwrapped {
  const wrappers: string[] = [];
  let splitsString = false;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    const wrapper = path.basename(token);
    const valueFlags = WRAPPER_VALUE_FLAGS.get(wrapper);
    if (ASSIGNMENT.test(token) || SHELL_KEYWORDS.has(token)) {
      index++;
      continue;
    }
    if (!valueFlags) break;
    wrappers.push(wrapper);
    index++;
    while (index < tokens.length && tokens[index]!.startsWith('-')) {
      const flag = tokens[index]!;
      if (wrapper === 'env' && ENV_SPLIT.test(flag)) splitsString = true;
      index += valueFlags.has(flag) ? 2 : 1;
    }
    index += WRAPPER_OPERANDS.get(wrapper) ?? 0;
  }
  return { program: tokens.slice(index), wrappers, splitsString };
}

export function programTokens(tokens: readonly string[]): string[] {
  return unwrapCommand(tokens).program;
}

export function resolveCommandPath(word: string, cwd: string, home: string): string {
  const expanded = word === '~' || word.startsWith('~/') ? path.join(home, word.slice(1)) : word;
  const staticPart = expanded.split(/[*?[{]/)[0] ?? '';
  const base = staticPart === '' ? '.' : staticPart;
  return path.resolve(cwd, base);
}

export function allowlistCovers(allowlist: readonly string[], command: string): boolean {
  const normalized = normalizeCommand(command);
  return allowlist.some((entry) => {
    const allowed = normalizeCommand(entry);
    if (allowed === '' || hasControlOperators(allowed)) return false;
    if (normalized === allowed) return true;
    return normalized.startsWith(`${allowed} `) && !hasControlOperators(normalized);
  });
}
