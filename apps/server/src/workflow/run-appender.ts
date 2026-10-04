import { EventType, type RunEvent } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import { appendRunEvents, type AppendOptions } from '../persistence/run-events.ts';
import type { Append } from './agent-turn.ts';

export const TEXT_FLUSH_MS = 50;
export const TEXT_FLUSH_CHARS = 8_192;

type Write = (events: readonly RunEvent[], options?: AppendOptions) => Promise<number>;

export interface TextBufferOptions {
  flushMs?: number;
  flushChars?: number;
  now?: () => number;
}

const unflushed = new Set<() => Promise<void>>();

export async function flushBufferedText(): Promise<void> {
  await Promise.all([...unflushed].map((flush) => flush()));
}

function isStreamedText(
  event: RunEvent,
  options: AppendOptions | undefined,
): event is Extract<RunEvent, { type: typeof EventType.TEXT_MESSAGE_CONTENT }> {
  return event.type === EventType.TEXT_MESSAGE_CONTENT && options === undefined;
}

export function bufferingText(write: Write, options: TextBufferOptions = {}): Append {
  const flushMs = options.flushMs ?? TEXT_FLUSH_MS;
  const flushChars = options.flushChars ?? TEXT_FLUSH_CHARS;
  const now = options.now ?? Date.now;
  let waiting: RunEvent[] = [];
  let waitingChars = 0;
  let timer: NodeJS.Timeout | null = null;
  let flushedAt = -Infinity;
  let lastWrite: Promise<unknown> = Promise.resolve();
  let failure: { error: unknown } | null = null;

  const take = (): RunEvent[] => {
    const taken = waiting;
    waiting = [];
    waitingChars = 0;
    if (timer) clearTimeout(timer);
    timer = null;
    unflushed.delete(flush);
    return taken;
  };

  const inOrder = (events: readonly RunEvent[], appendOptions?: AppendOptions) => {
    const writing = lastWrite.then(() => write(events, appendOptions));
    lastWrite = writing.catch(() => undefined);
    flushedAt = now();
    return writing;
  };

  const flush = async (): Promise<void> => {
    const taken = take();
    if (taken.length === 0) return;
    await inOrder(taken).catch((error: unknown) => {
      failure ??= { error };
    });
  };

  const raiseFailure = () => {
    if (!failure) return;
    const { error } = failure;
    failure = null;
    throw error;
  };

  return async (event, appendOptions) => {
    raiseFailure();
    if (!isStreamedText(event, appendOptions)) {
      return inOrder([...take(), event], appendOptions);
    }
    waiting.push(event);
    waitingChars += event.delta.length;
    unflushed.add(flush);
    if (waitingChars >= flushChars) {
      await flush();
      raiseFailure();
      return null;
    }
    timer ??= setTimeout(() => void flush(), Math.max(0, flushedAt + flushMs - now()));
    return null;
  };
}

export function runAppender(db: Db, lease: Lease, options: TextBufferOptions = {}): Append {
  return bufferingText(
    (events, appendOptions) => appendRunEvents(db, lease, events, appendOptions),
    options,
  );
}
