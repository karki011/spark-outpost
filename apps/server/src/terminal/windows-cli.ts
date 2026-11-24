import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loginShellLocator } from '../agents/acp/agent-cli.ts';

export interface CliRun {
  file: string;
  args: string[];
  verbatim: boolean;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  exists(file: string): boolean;
  read(file: string): string | null;
}

const win = path.win32;
const BATCH = /\.(cmd|bat)$/i;
const EXECUTABLE = /\.exe$/i;
const SCRIPT = /(\.c?js|\.mjs|[\\/][^\\/.]+)$/i;
const SHIM_TARGET = /^%~?dp0%?\\(.+)$/i;
const QUOTED = /"([^"]*)"/g;
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const SEARCH_ORDER = ['.exe', '.cmd', '.bat'];

export function cliDeps(env: Record<string, string | undefined> = process.env): CliDeps {
  return {
    env,
    exists: existsSync,
    read: (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
  };
}

function envValue(env: CliDeps['env'], name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function pathDirectories(env: CliDeps['env']): string[] {
  return (envValue(env, 'PATH') ?? '')
    .split(';')
    .map((directory) => directory.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

export function findOnPath(name: string, deps: CliDeps): string | null {
  const directories = pathDirectories(deps.env);
  for (const extension of SEARCH_ORDER) {
    for (const directory of directories) {
      const candidate = win.join(directory, `${name}${extension}`);
      if (deps.exists(candidate)) return candidate;
    }
  }
  return null;
}

export function shimTarget(text: string, shim: string): string | null {
  const line = text.split(/\r?\n/).findLast((candidate) => candidate.includes('%*'));
  if (!line) return null;
  const targets = [...line.matchAll(QUOTED)]
    .map((match) => SHIM_TARGET.exec(match[1] ?? '')?.[1])
    .filter((target): target is string => Boolean(target))
    .filter((target) => win.basename(target).toLowerCase() !== 'node.exe');
  const target = targets.at(-1);
  return target ? win.resolve(win.dirname(shim), target) : null;
}

function nodeFor(shim: string, deps: CliDeps): string | null {
  const beside = win.join(win.dirname(shim), 'node.exe');
  if (deps.exists(beside)) return beside;
  const found = findOnPath('node', deps);
  return found && EXECUTABLE.test(found) ? found : null;
}

function quoteForCmd(arg: string): string {
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

export function cmdLine(file: string, args: readonly string[]): string {
  if (args.some((arg) => /[\r\n]/.test(arg)))
    throw new Error(
      `${win.basename(file)} runs through cmd.exe, which can't pass a multi-line argument. Install the CLI's .exe or use npm's shim.`,
    );
  const command = win.normalize(file).replace(CMD_META, '^$1');
  return `"${[command, ...args.map(quoteForCmd)].join(' ')}"`;
}

function throughCmd(file: string, args: readonly string[], deps: CliDeps): CliRun {
  const system = envValue(deps.env, 'SYSTEMROOT') ?? 'C:\\Windows';
  const comspec = envValue(deps.env, 'COMSPEC') ?? win.join(system, 'System32', 'cmd.exe');
  return { file: comspec, args: ['/d', '/s', '/c', cmdLine(file, args)], verbatim: true };
}

export function windowsCliRun(file: string, args: readonly string[], deps: CliDeps): CliRun {
  if (!BATCH.test(file)) return { file, args: [...args], verbatim: false };
  const text = deps.read(file);
  const target = text ? shimTarget(text, file) : null;
  if (text && target && deps.exists(target)) {
    if (EXECUTABLE.test(target)) return { file: target, args: [...args], verbatim: false };
    const node = /node\.exe/i.test(text) && SCRIPT.test(target) ? nodeFor(file, deps) : null;
    if (node) return { file: node, args: [target, ...args], verbatim: false };
  }
  return throughCmd(file, args, deps);
}

export function cliRun(
  file: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  deps: CliDeps = cliDeps(),
): CliRun {
  if (platform !== 'win32') return { file, args: [...args], verbatim: false };
  return windowsCliRun(file, args, deps);
}

export function verbatimOption(run: CliRun): { windowsVerbatimArguments?: true } {
  return run.verbatim ? { windowsVerbatimArguments: true } : {};
}

export function ptyArgs(run: CliRun): string[] | string {
  return run.verbatim ? run.args.join(' ') : run.args;
}

export function terminalCliLocator(
  shell: string | null,
  platform: NodeJS.Platform = process.platform,
  deps: CliDeps = cliDeps(),
): (cli: string) => Promise<string | null> {
  if (platform !== 'win32') return loginShellLocator(shell);
  return (cli) => Promise.resolve(findOnPath(cli, deps));
}
