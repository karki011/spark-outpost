import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { z } from 'zod';
import {
  CALENDAR_HELPER_SILENT_MS,
  calendarHelperLineSchema,
  calendarHelperResultSchemas,
  type CalendarHelperErrorCode,
  type CalendarHelperOp,
  type CalendarHelperRequest,
} from '@spark-outpost/contracts';

export type CalendarHelperResult<Op extends CalendarHelperOp> = z.infer<
  (typeof calendarHelperResultSchemas)[Op]
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CalendarHelperCall = DistributiveOmit<CalendarHelperRequest, 'id'>;

export type CalendarHelperFailure = CalendarHelperErrorCode | 'stopped';

export class CalendarHelperError extends Error {
  readonly code: CalendarHelperFailure;

  constructor(code: CalendarHelperFailure, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CalendarHelper {
  call<Op extends CalendarHelperOp>(
    request: Extract<CalendarHelperCall, { op: Op }>,
  ): Promise<CalendarHelperResult<Op>>;
  kill(): void;
  readonly running: boolean;
}

export type SpawnCalendarHelper = (binary: string) => ChildProcessWithoutNullStreams;

export interface CalendarHelperOptions {
  binary: string;
  log(line: string): void;
  changed(): void;
  spawn?: SpawnCalendarHelper;
  silentMs?: number;
  newId?: () => string;
}

interface Waiting {
  op: CalendarHelperOp;
  resolve(result: unknown): void;
  reject(error: CalendarHelperError): void;
}

const LONG_OPS: ReadonlySet<CalendarHelperOp> = new Set(['request']);

const defaultSpawn: SpawnCalendarHelper = (binary) =>
  spawnProcess(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });

export function startCalendarHelper(options: CalendarHelperOptions): CalendarHelper {
  const spawn = options.spawn ?? defaultSpawn;
  const silentMs = options.silentMs ?? CALENDAR_HELPER_SILENT_MS;
  const newId = options.newId ?? randomUUID;
  let child: ChildProcessWithoutNullStreams | null = null;
  const waiting = new Map<string, Waiting>();
  let silence: NodeJS.Timeout | null = null;

  const failAll = (error: CalendarHelperError) => {
    for (const entry of waiting.values()) entry.reject(error);
    waiting.clear();
  };

  const quiet = () => {
    if (silence) clearTimeout(silence);
    silence = null;
  };

  const watch = () => {
    quiet();
    const timed = [...waiting.values()].some((entry) => !LONG_OPS.has(entry.op));
    if (!timed) return;
    silence = setTimeout(() => {
      options.log('The calendar helper went silent; restarting it.');
      stop(new CalendarHelperError('failed', 'The calendar helper stopped answering.'));
    }, silentMs);
  };

  const stop = (error: CalendarHelperError) => {
    const running = child;
    child = null;
    quiet();
    failAll(error);
    running?.kill('SIGKILL');
  };

  const settle = (id: string, outcome: (entry: Waiting) => void) => {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    watch();
    outcome(entry);
  };

  const answer = (line: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      options.log('The calendar helper wrote a line that is not JSON.');
      return;
    }
    const parsed = calendarHelperLineSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if ('event' in message) {
      options.changed();
      return;
    }
    if (!message.ok) {
      if (message.id === null) return;
      settle(message.id, (entry) =>
        entry.reject(new CalendarHelperError(message.code, message.message)),
      );
      return;
    }
    settle(message.id, (entry) => {
      const result = calendarHelperResultSchemas[entry.op].safeParse(message.result);
      if (result.success) entry.resolve(result.data);
      else
        entry.reject(
          new CalendarHelperError(
            'invalid',
            'The calendar helper sent an answer Spark cannot read.',
          ),
        );
    });
  };

  const ensure = (): ChildProcessWithoutNullStreams => {
    if (child) return child;
    const started = spawn(options.binary);
    child = started;
    createInterface({ input: started.stdout }).on('line', answer);
    started.stderr.on('data', (chunk: Buffer) => {
      options.log(`helper: ${chunk.toString('utf8').trim().slice(0, 300)}`);
    });
    const gone = (reason: string) => {
      if (child !== started) return;
      child = null;
      quiet();
      failAll(new CalendarHelperError('failed', `The calendar helper ${reason}.`));
    };
    started.once('error', (error) => gone(`could not start: ${error.message}`));
    started.once('exit', (code) => gone(`exited (${code ?? 'signal'})`));
    started.stdin.on('error', () => undefined);
    return started;
  };

  return {
    call(request) {
      const id = newId();
      return new Promise((resolve, reject) => {
        waiting.set(id, {
          op: request.op,
          resolve: (result) => resolve(result as never),
          reject,
        });
        ensure().stdin.write(`${JSON.stringify({ ...request, id })}\n`);
        watch();
      });
    },
    kill() {
      stop(new CalendarHelperError('stopped', 'The calendar helper was stopped.'));
    },
    get running() {
      return child !== null;
    },
  };
}
