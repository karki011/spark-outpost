import path from 'node:path';

const CONTROL_OPERATORS = /[;&|\n]|\$\(|`|[<>]/;
const SEPARATORS = new Set([';', '&', '|', '\n']);
const REDIRECTS = new Set(['<', '>']);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'env', 'xargs']);
const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function hasControlOperators(command: string): boolean {
  return CONTROL_OPERATORS.test(command);
}

export function splitSimpleCommands(command: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  const endToken = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length > 0) commands.push(tokens);
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
    } else if (SEPARATORS.has(char) || char === '(' || char === ')' || char === '`') {
      endCommand();
    } else if (char === '$' && command[index + 1] === '(') {
      endCommand();
      index++;
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

export function programTokens(tokens: readonly string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (ASSIGNMENT.test(token)) index++;
    else if (WRAPPERS.has(path.basename(token))) {
      index++;
      while (index < tokens.length && tokens[index]!.startsWith('-')) index++;
    } else break;
  }
  return tokens.slice(index);
}

export function isGitPush(command: string): boolean {
  return splitSimpleCommands(command).some((tokens) => {
    const program = programTokens(tokens);
    if (path.basename(program[0] ?? '') !== 'git') return false;
    return program.slice(1).some((token) => token === 'push');
  });
}

function isForceFlag(token: string): boolean {
  if (token === '--force' || token === '--mirror') return true;
  if (token.startsWith('--force-with-lease') || token === '--force-if-includes') return true;
  return /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token);
}

export function isGitForcePush(command: string): boolean {
  return splitSimpleCommands(command).some((tokens) => {
    const program = programTokens(tokens);
    if (path.basename(program[0] ?? '') !== 'git') return false;
    const pushAt = program.indexOf('push');
    if (pushAt < 1) return false;
    return program.slice(pushAt + 1).some((token) => isForceFlag(token) || /^\+[^+]/.test(token));
  });
}

export function deletedPaths(command: string): string[] {
  return splitSimpleCommands(command).flatMap((tokens) => {
    const program = programTokens(tokens);
    const name = path.basename(program[0] ?? '');
    const args = program.slice(1);
    if (DELETERS.has(name)) return args.filter((arg) => !arg.startsWith('-'));
    if (name === 'find' && args.includes('-delete')) {
      const searchRoots = args.slice(
        0,
        args.findIndex((arg) => arg.startsWith('-')),
      );
      return searchRoots.length > 0 ? searchRoots : ['.'];
    }
    return [];
  });
}

export function commandWords(command: string): string[] {
  return splitSimpleCommands(command).flat();
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

const REMOTE_CHANGES = new Set([
  'add',
  'set-url',
  'remove',
  'rm',
  'rename',
  'set-head',
  'set-branches',
]);
const HOSTING_CLIS = new Set(['gh', 'hub', 'glab', 'tea']);

function gitSubcommand(args: readonly string[]): { name: string; rest: string[] } | null {
  let index = 0;
  while (index < args.length) {
    const token = args[index]!;
    if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree') {
      index += 2;
    } else if (token.startsWith('-')) index += 1;
    else return { name: token, rest: args.slice(index + 1) };
  }
  return null;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function shellScript(program: readonly string[]): string | null {
  if (!SHELLS.has(path.basename(program[0] ?? ''))) return null;
  const flag = program.findIndex((token, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(token));
  return flag > 0 ? (program[flag + 1] ?? null) : null;
}

export function publishesCode(command: string, depth = 0): boolean {
  return splitSimpleCommands(command).some((tokens) => {
    const program = programTokens(tokens);
    const script = shellScript(program);
    if (script !== null) return depth < 3 && publishesCode(script, depth + 1);
    const name = path.basename(program[0] ?? '');
    if (HOSTING_CLIS.has(name)) return true;
    if (name !== 'git') return false;
    const sub = gitSubcommand(program.slice(1));
    if (!sub) return false;
    if (sub.name === 'push' || sub.name === 'send-email' || sub.name === 'request-pull') {
      return true;
    }
    return sub.name === 'remote' && sub.rest.some((token) => REMOTE_CHANGES.has(token));
  });
}
