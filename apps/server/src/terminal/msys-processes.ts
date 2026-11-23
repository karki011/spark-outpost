import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { defaultShell } from '../setup/default-shell.ts';

const execFileAsync = promisify(execFile);
const MSYS_LINE = /^\s*[A-Za-z]?\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/;
const MSYS_ARGS = ['-a', '-l'];

interface Linked {
  pid: number;
  ppid: number;
}

export function msysPs(shell: string = defaultShell()): string {
  const bin = path.win32.dirname(shell);
  const inUsr = path.win32.basename(path.win32.dirname(bin)).toLowerCase() === 'usr';
  return inUsr
    ? path.win32.join(bin, 'ps.exe')
    : path.win32.join(path.win32.dirname(bin), 'usr', 'bin', 'ps.exe');
}

export function withMsysParents<T extends Linked>(rows: readonly T[], msys: string | null): T[] {
  if (!msys) return [...rows];
  const windowsPidOf = new Map<number, number>();
  const parents: Array<[number, number]> = [];
  for (const line of msys.split('\n')) {
    const match = MSYS_LINE.exec(line);
    if (!match) continue;
    const [, pid, ppid, , winpid] = match.map(Number);
    windowsPidOf.set(pid!, winpid!);
    parents.push([winpid!, ppid!]);
  }
  const parentOf = new Map<number, number>();
  for (const [winpid, msysParent] of parents) {
    const parent = windowsPidOf.get(msysParent);
    if (parent !== undefined && parent !== winpid) parentOf.set(winpid, parent);
  }
  return rows.map((row) => {
    const parent = parentOf.get(row.pid);
    return parent === undefined ? row : { ...row, ppid: parent };
  });
}

function available(ps: string): boolean {
  return process.platform === 'win32' && existsSync(ps);
}

export async function msysTable(ps: string = msysPs()): Promise<string | null> {
  if (!available(ps)) return null;
  try {
    const { stdout } = await execFileAsync(ps, MSYS_ARGS, { encoding: 'utf8', windowsHide: true });
    return stdout;
  } catch {
    return null;
  }
}

export function msysTableNow(ps: string = msysPs()): string | null {
  if (!available(ps)) return null;
  try {
    return execFileSync(ps, MSYS_ARGS, { encoding: 'utf8', windowsHide: true });
  } catch {
    return null;
  }
}
