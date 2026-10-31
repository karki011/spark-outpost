import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Request, Response } from 'express';
import { isTerminalRunEvent, isTerminalRunStatus, parseRunCursors } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { getRun, listRunEventsAfter, RUN_EVENTS_PAGE } from '../persistence/runs.ts';
import { endFrame, type RunEventHub, type RunWatch } from './run-event-hub.ts';

const POLL_FALLBACK_MS = 1000;
const KEEP_ALIVE_MS = 15_000;

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

interface Stream {
  db: Db;
  hub: RunEventHub;
  res: Response;
  signal: AbortSignal;
  cursors: Map<string, number>;
  watch: RunWatch;
}

async function endRun(stream: Stream, runId: string, end: 'done' | 'missing'): Promise<void> {
  stream.watch.drop(runId);
  stream.cursors.delete(runId);
  await send(stream.res, endFrame(runId, end), stream.signal);
}

async function pump(stream: Stream, runId: string): Promise<boolean> {
  const batch = await listRunEventsAfter(stream.db, runId, stream.cursors.get(runId)!);
  for (const stored of batch) {
    if (stream.signal.aborted) return false;
    await send(stream.res, stream.hub.frame(runId, stored), stream.signal);
    stream.cursors.set(runId, stored.seq);
    if (isTerminalRunEvent(stored.event)) {
      await endRun(stream, runId, 'done');
      return false;
    }
  }
  return batch.length === RUN_EVENTS_PAGE;
}

async function openRun(stream: Stream, runId: string): Promise<void> {
  const run = await getRun(stream.db, runId);
  if (!run) {
    await endRun(stream, runId, 'missing');
    return;
  }
  if (!isTerminalRunStatus(run.status)) return;
  while (await pump(stream, runId));
  if (stream.cursors.has(runId) && !stream.signal.aborted) await endRun(stream, runId, 'done');
}

export async function streamRuns(db: Db, hub: RunEventHub, req: Request, res: Response) {
  const cursors = parseRunCursors(req.query.runs);
  if (!cursors) {
    res.status(400).json({ error: 'Name up to 64 runs as id:cursor.' });
    return;
  }
  const disconnected = new AbortController();
  req.on('close', () => disconnected.abort());
  const watch = hub.watch(cursors.keys());
  const stream: Stream = { db, hub, res, signal: disconnected.signal, cursors, watch };

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), KEEP_ALIVE_MS);

  try {
    for (const runId of [...cursors.keys()]) {
      if (disconnected.signal.aborted) return;
      await openRun(stream, runId);
    }
    while (!disconnected.signal.aborted && watch.size > 0) {
      const due = watch.take();
      for (const runId of due) {
        if (disconnected.signal.aborted) return;
        if (await pump(stream, runId)) watch.again(runId);
      }
      if (due.length > 0) await nextTurn();
      else await watch.changed(POLL_FALLBACK_MS, disconnected.signal);
    }
  } finally {
    clearInterval(keepAlive);
    watch.close();
    res.end();
  }
}
