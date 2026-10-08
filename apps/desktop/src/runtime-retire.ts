import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOST_SCRIPT = 'runtime-host.js ';
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

export async function isRuntimeHost(pid: number, directory: string): Promise<boolean> {
  let command: string;
  try {
    command = (await run('ps', ['-ww', '-o', 'args=', '-p', String(pid)])).stdout.trim();
  } catch {
    return false;
  }
  const start = command.indexOf(`${HOST_SCRIPT}${directory}`);
  if (start < 0) return false;
  const next = command[start + HOST_SCRIPT.length + directory.length];
  return next === undefined || next === ' ';
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
  throw new Error('The earlier local runtime did not stop. Restart the Mac, then reopen Spark.');
}
