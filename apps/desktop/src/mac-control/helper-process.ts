import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { z } from 'zod';
import {
  MAC_HELPER_SILENT_MS,
  macHelperResponseSchema,
  macHelperResultSchemas,
  type MacHelperErrorCode,
  type MacHelperOp,
  type MacHelperRequest,
} from '@spark-outpost/contracts';

export type MacHelperResult<Op extends MacHelperOp> = z.infer<(typeof macHelperResultSchemas)[Op]>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type MacHelperCall = DistributiveOmit<MacHelperRequest, 'id'>;

export type MacHelperFailure = MacHelperErrorCode | 'stopped' | 'failed' | 'cancelled';

export class MacHelperError extends Error {
  readonly code: MacHelperFailure;

  constructor(code: MacHelperFailure, message: string) {
    super(message);
    this.code = code;
  }
}

export interface MacHelper {
  call<Op extends MacHelperOp>(
    request: Extract<MacHelperCall, { op: Op }>,
    signal?: AbortSignal,
  ): Promise<MacHelperResult<Op>>;
  kill(): void;
  readonly pid: number | null;
}

export type SpawnHelper = (binary: string) => ChildProcessWithoutNullStreams;

export interface MacHelperOptions {
  binary: string;
  log(line: string): void;
  spawn?: SpawnHelper;
  silentMs?: number;
  newId?: () => string;
}

interface Waiting {
  op: MacHelperOp;
  resolve(result: unknown): void;
  reject(error: MacHelperError): void;
}

const defaultSpawn: SpawnHelper = (binary) =>
  spawnProcess(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });

export function startMacHelper(options: MacHelperOptions): MacHelper {
  const spawn = options.spawn ?? defaultSpawn;
  const silentMs = options.silentMs ?? MAC_HELPER_SILENT_MS;
  const newId = options.newId ?? randomUUID;
  let child: ChildProcessWithoutNullStreams | null = null;
  const waiting = new Map<string, Waiting>();
  let silence: NodeJS.Timeout | null = null;

  const failAll = (error: MacHelperError) => {
    for (const entry of waiting.values()) entry.reject(error);
    waiting.clear();
  };

  const quiet = () => {
    if (silence) clearTimeout(silence);
    silence = null;
  };

  const watch = () => {
    quiet();
    if (waiting.size === 0) return;
    silence = setTimeout(() => {
      options.log('The Mac control helper went silent; restarting it.');
      stop(new MacHelperError('failed', 'The Mac control helper stopped answering.'));
    }, silentMs);
  };

  const stop = (error: MacHelperError) => {
    const running = child;
    child = null;
    quiet();
    failAll(error);
    running?.kill('SIGKILL');
  };

  const answer = (line: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      options.log('The Mac control helper wrote a line that is not JSON.');
      return;
    }
    const parsed = macHelperResponseSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    watch();
    if (!message.ok) {
      entry.reject(new MacHelperError(message.code, message.message));
      return;
    }
    const result = macHelperResultSchemas[entry.op].safeParse(message.result);
    if (result.success) entry.resolve(result.data);
    else
      entry.reject(
        new MacHelperError('invalid', 'The Mac control helper sent an answer Spark cannot read.'),
      );
  };

  const ensure = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    const started = spawn(options.binary);
    child = started;
    createInterface({ input: started.stdout }).on('line', answer);
    started.stderr.on('data', (chunk: Buffer) => {
      options.log(`helper: ${chunk.toString('utf8').trim().slice(0, 500)}`);
    });
    const gone = (reason: string) => {
      if (child !== started) return;
      child = null;
      quiet();
      failAll(new MacHelperError('failed', `The Mac control helper ${reason}.`));
    };
    started.once('error', (error) => gone(`could not start: ${error.message}`));
    started.once('exit', (code) => gone(`exited (${code ?? 'signal'})`));
    started.stdin.on('error', () => undefined);
    return started;
  };

  return {
    call(request, signal) {
      if (signal?.aborted) return Promise.reject(new MacHelperError('cancelled', 'Cancelled.'));
      const id = newId();
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          if (!waiting.delete(id)) return;
          watch();
          reject(new MacHelperError('cancelled', 'Cancelled.'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        waiting.set(id, {
          op: request.op,
          resolve: (result) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(result as never);
          },
          reject: (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
          },
        });
        const process = ensure();
        process.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
        watch();
      });
    },
    kill() {
      stop(new MacHelperError('stopped', 'Mac control was stopped.'));
    },
    get pid() {
      return child?.pid ?? null;
    },
  };
}
