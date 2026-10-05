import { spawn } from 'node:child_process';

export const PUSH_TIMEOUT_MS = 30 * 60_000;
const KILL_GRACE_MS = 5_000;
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

export type PushEnd = 'exited' | 'timed_out' | 'cancelled';

export interface PushRun {
  code: number;
  output: string;
  ended: PushEnd;
}

export interface PushRunOptions {
  env: Record<string, string>;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

function boundedTail(chunks: Buffer[]): string {
  const all = Buffer.concat(chunks);
  return all.subarray(Math.max(0, all.length - OUTPUT_LIMIT_BYTES)).toString('utf8');
}

function stopGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
  }
}

export function runPush(root: string, args: readonly string[], options: PushRunOptions) {
  return new Promise<PushRun>((resolve) => {
    if (options.signal?.aborted) {
      resolve({ code: -1, output: '', ended: 'cancelled' });
      return;
    }
    const child = spawn('git', ['-C', root, ...args], {
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let ended: PushEnd = 'exited';
    let hardStop: NodeJS.Timeout | undefined;
    const collect = (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      while (size > OUTPUT_LIMIT_BYTES * 2 && chunks.length > 1) size -= chunks.shift()!.length;
    };
    const stop = (why: PushEnd) => {
      if (ended !== 'exited') return;
      ended = why;
      stopGroup(child.pid, 'SIGTERM');
      hardStop = setTimeout(() => stopGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timed_out'), options.timeoutMs ?? PUSH_TIMEOUT_MS);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = (code: number) => {
      clearTimeout(timer);
      clearTimeout(hardStop);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code, output: boundedTail(chunks), ended });
    };
    child.once('error', () => finish(-1));
    child.once('close', (code) => finish(code ?? -1));
  });
}
