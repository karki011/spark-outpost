import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Request, Response } from 'express';
import { isTerminalRunEvent, isTerminalRunStatus } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { getRun, listRunEventsAfter } from '../persistence/runs.ts';
import type { RunEventHub } from './run-event-hub.ts';

const POLL_FALLBACK_MS = 1000;
const KEEP_ALIVE_MS = 15_000;

export function parseCursor(req: Request): number {
  const raw =
    req.header('last-event-id') ?? (typeof req.query.after === 'string' ? req.query.after : '0');
  const cursor = Number.parseInt(raw, 10);
  return Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
}

function drained(res: Response, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
    signal.addEventListener('abort', done, { once: true });
  });
}

async function send(res: Response, frame: string, signal: AbortSignal): Promise<void> {
  if (!res.write(frame) && !signal.aborted) await drained(res, signal);
}

export async function streamRunEvents(
  db: Db,
  hub: RunEventHub,
  runId: string,
  req: Request,
  res: Response,
): Promise<void> {
  const run = await getRun(db, runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found.' });
    return;
  }

  let cursor = parseCursor(req);
  const firstBatch = await listRunEventsAfter(db, runId, cursor);
  if (firstBatch.length === 0 && isTerminalRunStatus(run.status)) {
    res.status(204).end();
    return;
  }

  const disconnected = new AbortController();
  req.on('close', () => disconnected.abort());

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), KEEP_ALIVE_MS);

  try {
    let batch = firstBatch;
    while (!disconnected.signal.aborted) {
      for (const stored of batch) {
        await send(res, hub.frame(runId, stored), disconnected.signal);
        cursor = stored.seq;
        if (isTerminalRunEvent(stored.event)) return;
        if (disconnected.signal.aborted) return;
      }
      if (batch.length === 0) await hub.waitFor(runId, POLL_FALLBACK_MS, disconnected.signal);
      else await nextTurn();
      if (disconnected.signal.aborted) return;
      batch = await listRunEventsAfter(db, runId, cursor);
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}
