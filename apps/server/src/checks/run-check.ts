import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';
import { CHECK_OUTPUT_TAIL_BYTES } from '@spark-outpost/contracts';
import { isSensitiveEnvKey, redactText, storableText } from '../audit/redact.ts';
import { relativeInside } from '../projects/path-policy.ts';
import { isSecretEnvName } from '../setup/environment.ts';
import type { CheckCommand } from './detect.ts';

export const CHECK_TIMEOUT_MS = 120_000;
const KILL_GRACE_MS = 2_000;
const DATABASE_ENV = /^(?:DATABASE_URL|TEST_DATABASE_URL|PG[A-Z]+)$/;

export interface CheckRun {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  outputTail: string;
  truncated: boolean;
}

export class OutsideProjectError extends Error {
  constructor() {
    super('Checks only run inside the project folder.');
  }
}

export async function insideProject(root: string, cwd: string): Promise<boolean> {
  const [realRoot, realCwd] = await Promise.all([realpath(root), realpath(cwd)]);
  return realRoot === realCwd || relativeInside(realRoot, realCwd) !== null;
}

export function checkEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(
    ([key]) => !isSensitiveEnvKey(key) && !isSecretEnvName(key) && !DATABASE_ENV.test(key),
  );
  return { ...Object.fromEntries(kept), CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
}

export class OutputTail {
  private chunks: Buffer[] = [];
  private kept = 0;
  total = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.total += chunk.length;
    this.chunks.push(chunk);
    this.kept += chunk.length;
    while (this.kept - (this.chunks[0]?.length ?? 0) >= this.limit) {
      this.kept -= this.chunks.shift()!.length;
    }
  }

  text(): { text: string; truncated: boolean } {
    const joined = Buffer.concat(this.chunks);
    const tail = joined.subarray(Math.max(0, joined.length - this.limit));
    const text = storableText(redactText(stripVTControlCharacters(tail.toString('utf8'))));
    return { text, truncated: this.total > tail.length };
  }
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    return;
  }
}

export interface RunOptions {
  root: string;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export async function runCheck(check: CheckCommand, options: RunOptions): Promise<CheckRun> {
  if (!(await insideProject(options.root, options.cwd))) throw new OutsideProjectError();
  const started = Date.now();
  const tail = new OutputTail(CHECK_OUTPUT_TAIL_BYTES);
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  return new Promise<CheckRun>((resolve) => {
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const child = spawn(check.argv[0]!, check.argv.slice(1), {
      cwd: options.cwd,
      env: checkEnv(options.env),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = () => {
      killGroup(child.pid, 'SIGTERM');
      setTimeout(() => killGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => tail.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => tail.push(chunk));
    const finish = (exitCode: number | null, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (extra) tail.push(Buffer.from(extra));
      const output = tail.text();
      resolve({
        exitCode,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
        outputTail: output.text,
        truncated: output.truncated,
      });
    };
    child.on('error', (error) => finish(null, `\n${error.message}\n`));
    child.on('close', (code) => finish(code));
    if (options.signal?.aborted) onAbort();
  });
}
