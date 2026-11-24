import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import {
  winHelperEnv,
  winHelperLineSchema,
  winHelperResultSchemas,
  type WinHelperOp,
  type WinHelperRequest,
  type WinHelperResult,
} from './protocol.ts';

const QUICK_MS = 10_000;
const USER_PACED: ReadonlySet<WinHelperOp> = new Set(['hello.verify']);

export class WinHelperError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WinHelper {
  call<Op extends WinHelperOp>(
    request: Extract<WinHelperRequest, { op: Op }>,
  ): Promise<WinHelperResult<Op>>;
  kill(): void;
}

export type SpawnWinHelper = (binary: string) => ChildProcessWithoutNullStreams;

export interface WinHelperOptions {
  binary: string;
  log(line: string): void;
  spawn?: SpawnWinHelper;
  quickMs?: number;
  newId?: () => string;
}

interface Waiting {
  op: WinHelperOp;
  timer: NodeJS.Timeout | null;
  resolve(result: unknown): void;
  reject(error: WinHelperError): void;
}

const defaultSpawn: SpawnWinHelper = (binary) =>
  spawnProcess(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: winHelperEnv(process.env),
    windowsHide: true,
  });

export function startWinHelper(options: WinHelperOptions): WinHelper {
  const spawn = options.spawn ?? defaultSpawn;
  const quickMs = options.quickMs ?? QUICK_MS;
  const newId = options.newId ?? randomUUID;
  const waiting = new Map<string, Waiting>();
  let child: ChildProcessWithoutNullStreams | null = null;

  const take = (id: string): Waiting | undefined => {
    const entry = waiting.get(id);
    if (!entry) return undefined;
    waiting.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    return entry;
  };

  const failAll = (error: WinHelperError) => {
    for (const id of [...waiting.keys()]) take(id)?.reject(error);
  };

  const stop = (error: WinHelperError) => {
    const running = child;
    child = null;
    failAll(error);
    running?.kill();
  };

  const answer = (line: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      options.log('The Windows helper wrote a line that is not JSON.');
      return;
    }
    const parsed = winHelperLineSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.id === null) return;
    const entry = take(message.id);
    if (!entry) return;
    if (!message.ok) {
      entry.reject(new WinHelperError(message.code, message.message));
      return;
    }
    const result = winHelperResultSchemas[entry.op].safeParse(message.result);
    if (result.success) entry.resolve(result.data);
    else
      entry.reject(new WinHelperError('invalid', 'The Windows helper sent an unreadable answer.'));
  };

  const ensure = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    const started = spawn(options.binary);
    child = started;
    createInterface({ input: started.stdout }).on('line', answer);
    started.stderr.on('data', (chunk: Buffer) => {
      options.log(`win-helper: ${chunk.toString('utf8').trim().slice(0, 300)}`);
    });
    const gone = (reason: string) => {
      if (child !== started) return;
      child = null;
      failAll(new WinHelperError('failed', `The Windows helper ${reason}.`));
    };
    started.once('error', (error) => gone(`could not start: ${error.message}`));
    started.once('exit', (code) => gone(`exited (${code ?? 'signal'})`));
    started.stdin.on('error', () => undefined);
    return started;
  };

  const timeout = (id: string, op: WinHelperOp): NodeJS.Timeout | null => {
    if (USER_PACED.has(op)) return null;
    const timer = setTimeout(() => {
      if (!waiting.has(id)) return;
      options.log('The Windows helper stopped answering; restarting it.');
      stop(new WinHelperError('failed', 'The Windows helper stopped answering.'));
    }, quickMs);
    timer.unref();
    return timer;
  };

  return {
    call(request) {
      const id = newId();
      return new Promise((resolve, reject) => {
        waiting.set(id, {
          op: request.op,
          timer: timeout(id, request.op),
          resolve: (result) => resolve(result as never),
          reject,
        });
        ensure().stdin.write(`${JSON.stringify({ ...request, id })}\n`);
      });
    },
    kill() {
      stop(new WinHelperError('stopped', 'The Windows helper was stopped.'));
    },
  };
}
