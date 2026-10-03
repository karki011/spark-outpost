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

export function commandLabel(args: string): string {
  const [program = '', ...rest] = args.trim().split(/\s+/);
  const name = path.basename(program).replace(/^-/, '');
  const [script, ...scriptArgs] = rest;
  const words =
    INTERPRETERS.test(name) && script?.includes('/')
      ? [path.basename(script).replace(SCRIPT_EXTENSION, ''), ...scriptArgs]
      : [name, ...rest];
  const label = words.join(' ');
  return label.length > COMMAND_MAX_LENGTH ? `${label.slice(0, COMMAND_MAX_LENGTH - 1)}…` : label;
}

export function runningCommand(root: number, table: readonly ProcessRow[]): string | null {
  const descendants = new Set(descendantsOf(root, table));
  const running = table.filter((row) => descendants.has(row.pid));
  const foreground = table.find((row) => row.pid === root)?.foregroundGroup;
  const main =
    running.find((row) => row.pid === foreground) ??
    running.find((row) => row.ppid === root) ??
    running[0];
  return main ? commandLabel(main.args) : null;
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

function processTableNow(): ProcessRow[] {
  try {
    return parseProcessTable(execFileSync('/bin/ps', PS_ARGS, { encoding: 'utf8' }));
  } catch {
    return [];
  }
}

export async function processTable(): Promise<ProcessRow[]> {
  try {
    const { stdout } = await execFileAsync('/bin/ps', PS_ARGS, { encoding: 'utf8' });
    return parseProcessTable(stdout);
  } catch {
    return [];
  }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {
    return;
  }
}

export function killProcessTree(root: number, graceMs = 1500): void {
  const targets = [root, ...descendantsOf(root, processTableNow())];
  for (const pid of targets) signal(pid, 'SIGHUP');
  signal(-root, 'SIGHUP');
  const escalate = setTimeout(() => {
    for (const pid of targets) if (isAlive(pid)) signal(pid, 'SIGKILL');
  }, graceMs);
  escalate.unref();
}
