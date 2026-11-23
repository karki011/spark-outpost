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

const WINDOWS_TABLE = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) 0 $($_.CommandLine)" }',
].join('; ');

function processTable(): ProcessRow[] {
  const result =
    process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_TABLE], {
          encoding: 'utf8',
          windowsHide: true,
        })
      : spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' });
  return result.status === 0 ? parseProcessTable(result.stdout.replaceAll('\r', '')) : [];
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

const TEMP_VARIABLES = process.platform === 'win32' ? ['TMPDIR', 'TEMP', 'TMP'] : ['TMPDIR'];

export default function setup(): () => Promise<void> {
  const previous = TEMP_VARIABLES.map((name) => [name, process.env[name]] as const);
  const folder = mkdtempSync(path.join(tmpdir(), SHORT_PREFIX_FOR_SOCKET_PATHS));
  for (const name of TEMP_VARIABLES) process.env[name] = folder;
  return async () => {
    await stopProcessesUsing(folder);
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
