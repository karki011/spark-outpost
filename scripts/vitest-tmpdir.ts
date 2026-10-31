import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseProcessTable, type ProcessRow } from './slot-processes.ts';

const SHORT_PREFIX_FOR_SOCKET_PATHS = 'sv-';
const STOP_WAIT_MS = 2_000;

export function processesUsing(
  rows: readonly ProcessRow[],
  folder: string,
  self: number,
): number[] {
  return rows
    .filter((row) => row.pid !== self && row.command.includes(folder))
    .map((row) => row.pid);
}

function processTable(): ProcessRow[] {
  const result = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,command='], {
    encoding: 'utf8',
  });
  return result.status === 0 ? parseProcessTable(result.stdout) : [];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    return;
  }
}

async function stopProcessesUsing(folder: string): Promise<void> {
  const pids = processesUsing(processTable(), folder, process.pid);
  for (const pid of pids) signal(pid, 'SIGTERM');
  const deadline = Date.now() + STOP_WAIT_MS;
  while (pids.some(alive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');
}

export default function setup(): () => Promise<void> {
  const previous = process.env.TMPDIR;
  const folder = mkdtempSync(path.join(tmpdir(), SHORT_PREFIX_FOR_SOCKET_PATHS));
  process.env.TMPDIR = folder;
  return async () => {
    await stopProcessesUsing(folder);
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  };
}
