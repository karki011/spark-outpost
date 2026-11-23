import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOST_SCRIPT = 'runtime-host.js';
export const RETIRE_TIMEOUT_MS = 30_000;

interface Retirement {
  directory: string;
  pid: number | null;
  stop: (() => Promise<void>) | null;
  timeoutMs?: number;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function recordedPid(endpoint: string): Promise<number | null> {
  try {
    const { pid } = JSON.parse(await readFile(endpoint, 'utf8')) as { pid?: unknown };
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function namesRuntimeHost(command: string, directory: string): boolean {
  const host = new RegExp(`${escaped(HOST_SCRIPT)}"? ("?)${escaped(directory)}\\1(?: |$)`);
  return host.test(command);
}

async function commandLine(pid: number): Promise<string> {
  if (process.platform !== 'win32') {
    return (await run('ps', ['-ww', '-o', 'args=', '-p', String(pid)])).stdout.trim();
  }
  const query = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`;
  const { stdout } = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    query,
  ]);
  return stdout.trim();
}

export async function isRuntimeHost(pid: number, directory: string): Promise<boolean> {
  try {
    return namesRuntimeHost(await commandLine(pid), directory);
  } catch {
    return false;
  }
}

async function exited(pid: number, deadline: number): Promise<boolean> {
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await delay(50);
  }
  return true;
}

export async function retireHost(retirement: Retirement): Promise<void> {
  const { directory, pid, stop, timeoutMs = RETIRE_TIMEOUT_MS } = retirement;
  if (stop) {
    const deadline = Date.now() + timeoutMs;
    await Promise.race([
      stop().catch(() => undefined),
      delay(timeoutMs, undefined, { ref: false }),
    ]);
    if (pid !== null && (await exited(pid, deadline))) return;
  }
  if (pid === null) return;
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    if (!isAlive(pid) || !(await isRuntimeHost(pid, directory))) return;
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
    if (await exited(pid, Date.now() + timeoutMs)) return;
  }
  const computer = process.platform === 'win32' ? 'your computer' : 'the Mac';
  throw new Error(
    `The earlier local runtime did not stop. Restart ${computer}, then reopen Spark.`,
  );
}
