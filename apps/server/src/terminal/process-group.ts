import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PS_ARGS = ['-A', '-o', 'pid=,ppid=,tpgid=,args='];

export interface ProcessRow {
  pid: number;
  ppid: number;
  foregroundGroup: number;
  args: string;
}

const PS_LINE = /^(\d+)\s+(\d+)\s+(-?\d+)\s+(.*)$/;
const INTERPRETERS = /^(node|bun|deno|python[\d.]*|ruby|perl)$/;
const SCRIPT_EXTENSION = /\.(c?js|mjs|py|rb)$/;
const COMMAND_MAX_LENGTH = 60;
const NOT_A_COMMAND = /^\(.*\)$|<defunct>$/;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function descendantsOf(
  root: number,
  table: ReadonlyArray<Pick<ProcessRow, 'pid' | 'ppid'>>,
): number[] {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

const WINDOWS_PROGRAM = /^(?:"([^"]+)"|([A-Za-z]:\\.*?\.exe)(?=\s|$)|(\S+))\s*(.*)$/i;
const GIT_BASH_SHELL = /\\usr\\bin\\bash\.exe$/i;

function splitProgram(args: string, platform: NodeJS.Platform): [string, string[]] {
  const trimmed = args.trim();
  if (platform !== 'win32') {
    const [program = '', ...rest] = trimmed.split(/\s+/);
    return [program, rest];
  }
  const match = WINDOWS_PROGRAM.exec(trimmed);
  const program = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  const rest = match?.[4] ? match[4].split(/\s+/) : [];
  return [program, rest];
}

function programName(program: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return path.basename(program).replace(/^-/, '');
  return path.win32
    .basename(program)
    .replace(/\.exe$/i, '')
    .replace(/^-/, '');
}

export function commandLabel(args: string, platform: NodeJS.Platform = process.platform): string {
  const [program, rest] = splitProgram(args, platform);
  const name = programName(program, platform);
  const [script, ...scriptArgs] = rest;
  const words =
    INTERPRETERS.test(name) && script?.includes('/')
      ? [path.basename(script).replace(SCRIPT_EXTENSION, ''), ...scriptArgs]
      : [name, ...rest];
  const label = words.join(' ');
  return label.length > COMMAND_MAX_LENGTH ? `${label.slice(0, COMMAND_MAX_LENGTH - 1)}…` : label;
}

function shellRoot(root: number, table: readonly ProcessRow[], platform: NodeJS.Platform): number {
  if (platform !== 'win32') return root;
  const [program] = splitProgram(table.find((row) => row.pid === root)?.args ?? '', platform);
  if (GIT_BASH_SHELL.test(program)) return root;
  const shell = table.find(
    (row) => row.ppid === root && GIT_BASH_SHELL.test(splitProgram(row.args, platform)[0]),
  );
  return shell?.pid ?? root;
}

export function runningCommand(
  wrapper: number,
  table: readonly ProcessRow[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  const root = shellRoot(wrapper, table, platform);
  const descendants = new Set(descendantsOf(root, table));
  const running = table.filter((row) => descendants.has(row.pid) && !NOT_A_COMMAND.test(row.args));
  const foreground = table.find((row) => row.pid === root)?.foregroundGroup;
  const main =
    running.find((row) => row.pid === foreground) ??
    running.find((row) => row.ppid === root) ??
    running[0];
  return main ? commandLabel(main.args, platform) : null;
}

function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split('\n')) {
    const match = PS_LINE.exec(line.trim());
    if (!match) continue;
    const [, pid, ppid, foregroundGroup, args] = match;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      foregroundGroup: Number(foregroundGroup),
      args: args ?? '',
    });
  }
  return rows;
}

const WINDOWS_TABLE = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) 0 $($_.CommandLine)" }',
].join('; ');

function system32(file: string): string {
  return path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', file);
}

function powerShell(script: string): [string, string[]] {
  const powershell = system32('WindowsPowerShell\\v1.0\\powershell.exe');
  return [powershell, ['-NoProfile', '-NonInteractive', '-Command', script]];
}

export async function powerShellOutput(script: string): Promise<string> {
  const [command, args] = powerShell(script);
  const { stdout } = await execFileAsync(command, args, { encoding: 'utf8', windowsHide: true });
  return stdout;
}

function tableCommand(): [string, string[]] {
  return process.platform === 'win32' ? powerShell(WINDOWS_TABLE) : ['/bin/ps', PS_ARGS];
}

export async function processTable(): Promise<ProcessRow[]> {
  try {
    const [command, args] = tableCommand();
    const { stdout } = await execFileAsync(command, args, { encoding: 'utf8', windowsHide: true });
    return parseProcessTable(stdout);
  } catch {
    return [];
  }
}

export function endWindowsTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      system32('taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      () => resolve(),
    );
  });
}

export function signalGroup(
  pid: number,
  name: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'win32') {
    void endWindowsTree(pid);
    return true;
  }
  try {
    process.kill(-pid, name);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {
    return;
  }
}

export function processTreeNow(root: number): number[] {
  try {
    const [command, args] = tableCommand();
    return descendantsOf(
      root,
      parseProcessTable(execFileSync(command, args, { encoding: 'utf8', windowsHide: true })),
    );
  } catch {
    return [];
  }
}

const killsInFlight = new Set<Promise<void>>();

export function killProcessTree(
  root: number,
  graceMs = 1500,
  first: NodeJS.Signals = 'SIGHUP',
  seenEarlier: readonly number[] = [],
): Promise<void> {
  const killing = signalTree(root, graceMs, first, seenEarlier);
  killsInFlight.add(killing);
  void killing.finally(() => killsInFlight.delete(killing));
  return killing;
}

export async function processKillsSent(): Promise<void> {
  await Promise.all([...killsInFlight]);
}

async function signalTree(
  root: number,
  graceMs: number,
  first: NodeJS.Signals,
  seenEarlier: readonly number[],
): Promise<void> {
  const orphaned = seenEarlier.filter((pid) => isAlive(pid));
  const roots = [root, ...orphaned];
  if (process.platform === 'win32') {
    await Promise.all(roots.map((pid) => endWindowsTree(pid)));
    return;
  }
  const table = await processTable();
  const targets = [...new Set(roots.flatMap((pid) => [pid, ...descendantsOf(pid, table)]))];
  for (const pid of targets) signal(pid, first);
  signal(-root, first);
  const escalate = setTimeout(() => {
    for (const pid of targets) if (isAlive(pid)) signal(pid, 'SIGKILL');
  }, graceMs);
  escalate.unref();
}
