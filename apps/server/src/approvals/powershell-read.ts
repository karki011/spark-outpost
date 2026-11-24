import { tmpdir } from 'node:os';
import { gatePaths, toGatePath } from './gate-path.ts';
import type { ApprovalRequest } from './decide.ts';
import { powershellScript } from './powershell-command.ts';
import {
  PIPE_FILTERS,
  cmdletName,
  cmdletSpec,
  nativeName,
  type CmdletSpec,
} from './powershell-cmdlets.ts';
import {
  parsePowerShell,
  type PsArg,
  type PsCommand,
  type PsRedirect,
} from './powershell-parse.ts';

class Unreadable extends Error {}

function fail(): never {
  throw new Unreadable();
}

type Bound = Map<string, PsArg[]>;

function quote(text: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function globWord(text: string): string {
  return text.replace(/[^A-Za-z0-9_*?[\]/.:~=+@%^-]/g, (char) => `\\${char}`);
}

function gatePath(text: string, temp: boolean): string {
  const forward = text.replaceAll('\\', '/');
  if (temp) return gatePaths.join(toGatePath(tmpdir(), 'win32'), forward);
  return toGatePath(forward, 'win32');
}

function pathWord(arg: PsArg, literal: boolean): string {
  if (arg.kind !== 'value') return fail();
  const path = gatePath(arg.text, arg.temp);
  if (path === '~' || path.startsWith('~/'))
    return `~${path.length > 1 ? quote(path.slice(1)) : ''}`;
  const glob = !literal && !arg.quoted && /[*?[]/.test(path);
  return glob ? globWord(path) : quote(path);
}

function plain(arg: PsArg): string {
  if (arg.kind !== 'value' || arg.temp) return fail();
  return arg.text;
}

function parameterOf(spec: CmdletSpec, name: string): string {
  const lower = name.replace(/^-/, '').toLowerCase();
  if (!name.startsWith('-') || name.startsWith('--')) fail();
  const resolved = spec.aliases?.[lower] ?? lower;
  if (spec.values.includes(resolved) || spec.switches.includes(resolved)) return resolved;
  return fail();
}

function bind(spec: CmdletSpec, args: readonly PsArg[]): Bound {
  const bound: Bound = new Map();
  const add = (name: string, value: PsArg) => {
    if (bound.has(name)) fail();
    bound.set(name, [value]);
  };
  const positional = [...spec.positional];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.kind === 'value') {
      if (arg.glued) fail();
      const name = positional.find((candidate) => !bound.has(candidate));
      if (!name) fail();
      add(name, arg);
      continue;
    }
    const name = parameterOf(spec, arg.name);
    if (spec.switches.includes(name)) {
      if (arg.colon) {
        const value = args[++index];
        if (value?.kind !== 'value' || !/^\$(true|false)$/.test(value.text)) fail();
        if (value.text === '$true') add(name, value);
      } else add(name, { kind: 'value', text: '$true', quoted: false, glued: false, temp: false });
      continue;
    }
    const value = args[++index];
    if (value?.kind !== 'value' || (value.glued && !arg.colon)) fail();
    add(name, value);
  }
  return bound;
}

function one(bound: Bound, ...names: string[]): PsArg | null {
  const found = names.flatMap((name) => bound.get(name) ?? []);
  if (found.length > 1) fail();
  return found[0] ?? null;
}

function isOn(bound: Bound, name: string): boolean {
  return bound.has(name);
}

function targetOf(bound: Bound, pathName = 'path'): string {
  const literal = one(bound, 'literalpath');
  const arg = one(bound, pathName) ?? literal;
  if (!arg || (literal && one(bound, pathName))) fail();
  return pathWord(arg, arg === literal);
}

function newItemPath(bound: Bound): string {
  const path = one(bound, 'path');
  const name = one(bound, 'name');
  if (!path && !name) fail();
  if (!name) return pathWord(path!, false);
  if (/[\\/]/.test(plain(name))) fail();
  const base = path ? gatePath(plain(path), path.kind === 'value' && path.temp) : '.';
  return quote(gatePaths.join(base, plain(name)));
}

function renamed(bound: Bound): string {
  const target = one(bound, 'literalpath') ?? one(bound, 'path');
  const newName = one(bound, 'newname');
  if (!target || !newName || /[\\/]/.test(plain(newName))) fail();
  const from = gatePath(plain(target), target.kind === 'value' && target.temp);
  return `mv -- ${quote(from)} ${quote(gatePaths.join(gatePaths.dirname(from), plain(newName)))}`;
}

function cmdletBash(spec: CmdletSpec, bound: Bound, piped: boolean): string {
  switch (spec.name) {
    case 'Get-Content':
      return `cat -- ${targetOf(bound)}`;
    case 'Set-Content':
    case 'Add-Content': {
      const to = spec.name === 'Set-Content' ? '>' : '>>';
      return `${piped && !bound.has('value') ? 'cat' : 'echo'} ${to} ${targetOf(bound)}`;
    }
    case 'Out-File':
      return `${piped ? 'cat' : 'echo'} ${isOn(bound, 'append') ? '>>' : '>'} ${targetOf(bound, 'filepath')}`;
    case 'Tee-Object':
      return `tee ${isOn(bound, 'append') ? '-a ' : ''}-- ${targetOf(bound, 'filepath')}`;
    case 'New-Item': {
      const type = one(bound, 'itemtype');
      const kind = type ? plain(type).toLowerCase() : 'file';
      if (kind === 'directory') return `mkdir -p -- ${newItemPath(bound)}`;
      if (kind !== 'file') fail();
      return `echo > ${newItemPath(bound)}`;
    }
    case 'mkdir':
      return `mkdir -p -- ${newItemPath(bound)}`;
    case 'Remove-Item':
      return `rm ${isOn(bound, 'recurse') ? '-r ' : ''}-f -- ${targetOf(bound)}`;
    case 'Copy-Item':
    case 'Move-Item': {
      const destination = one(bound, 'destination');
      const to = destination ? pathWord(destination, true) : quote('.');
      const verb = spec.name === 'Copy-Item' ? `cp${isOn(bound, 'recurse') ? ' -r' : ''}` : 'mv -f';
      return `${verb} -- ${targetOf(bound)} ${to}`;
    }
    case 'Rename-Item':
      return renamed(bound);
    case 'Get-ChildItem': {
      const recurse = isOn(bound, 'recurse') ? ' -R' : '';
      const listed = one(bound, 'path') ?? one(bound, 'literalpath');
      return listed ? `ls${recurse} -- ${targetOf(bound)}` : `ls${recurse}`;
    }
    case 'Select-String': {
      const pattern = one(bound, 'pattern');
      if (!pattern) fail();
      const searched = one(bound, 'path') ?? one(bound, 'literalpath');
      return `grep -e ${quote(plain(pattern))}${searched ? ` -- ${targetOf(bound)}` : ''}`;
    }
    case 'Test-Path':
      return `test -e ${targetOf(bound)}`;
    case 'Set-Location':
    case 'Push-Location':
      return `cd -- ${targetOf(bound)}`;
    case 'Get-Location':
      return 'pwd';
    default:
      return fail();
  }
}

function echoed(command: PsCommand): string {
  const spec = cmdletSpec(command.name)!;
  const words: string[] = [];
  for (let index = 0; index < command.args.length; index++) {
    const arg = command.args[index]!;
    if (arg.kind === 'value') {
      words.push(quote(plain(arg)));
      continue;
    }
    const name = parameterOf(spec, arg.name);
    if (spec.values.includes(name)) index++;
  }
  return ['echo', ...words].join(' ');
}

const PATH_CHARS = /^[\w.:~\\/-]+$/;
const WINDOWS_PATHISH = /\\|^[A-Za-z]:[\\/]/;

function nativeArgs(args: readonly PsArg[]): string[] {
  const words: string[] = [];
  for (const arg of args) {
    const text =
      arg.kind === 'param'
        ? arg.name + (arg.colon ? ':' : '')
        : arg.kind === 'value' && arg.temp
          ? gatePath(arg.text, true)
          : plain(arg);
    const pathLike = arg.kind === 'value' && PATH_CHARS.test(text) && WINDOWS_PATHISH.test(text);
    const word = pathLike ? gatePath(text, false) : text;
    if (arg.glued && words.length > 0) words[words.length - 1] += word;
    else words.push(word);
  }
  return words.map(quote);
}

function redirectBash(redirect: PsRedirect): string {
  if (redirect.target === null) return redirect.operator;
  const target =
    redirect.target === '/dev/null' && !redirect.quoted
      ? '/dev/null'
      : quote(gatePath(redirect.target, false));
  switch (redirect.operator) {
    case '>':
    case '1>':
      return `> ${target}`;
    case '>>':
    case '1>>':
      return `>> ${target}`;
    case '2>':
      return `2> ${target}`;
    case '2>>':
      return `2>> ${target}`;
    case '*>':
      return `> ${target} 2>&1`;
    case '*>>':
      return `>> ${target} 2>&1`;
    default:
      return fail();
  }
}

function commandBash(command: PsCommand, piped: boolean): string {
  const name = cmdletName(command.name);
  const spec = cmdletSpec(command.name);
  let text: string;
  if (spec && (spec.name === 'Write-Output' || spec.name === 'Write-Host')) text = echoed(command);
  else if (spec) text = cmdletBash(spec, bind(spec, command.args), piped);
  else if (PIPE_FILTERS.has(name)) text = 'cat';
  else {
    const native = nativeName(command.name);
    if (!native) fail();
    text = [native, ...nativeArgs(command.args)].join(' ');
  }
  return [text, ...command.redirects.map(redirectBash)].join(' ');
}

export async function readPowerShell(command: string): Promise<string | null> {
  const script = powershellScript(command);
  if (script === null) return null;
  const steps = await parsePowerShell(script);
  if (!steps) return null;
  try {
    return steps
      .map(({ join, command: step }) => {
        const text = commandBash(step, join === '|');
        return join === null ? text : `${join === ';' ? ';' : ` ${join}`} ${text}`;
      })
      .join('');
  } catch (error) {
    if (error instanceof Unreadable) return null;
    throw error;
  }
}

export interface CommandReading {
  readAs: string | null;
  unreadable: boolean;
}

export async function readCodexCommand(
  request: ApprovalRequest,
  powershell: boolean,
): Promise<CommandReading> {
  if (!powershell || request.kind !== 'execute' || !request.command) {
    return { readAs: null, unreadable: false };
  }
  const readAs = await readPowerShell(request.command);
  return { readAs, unreadable: readAs === null };
}
