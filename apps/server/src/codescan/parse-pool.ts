import { Worker } from 'node:worker_threads';
import type { ParseRequest, ParseResponse } from './parse-worker.ts';
import type { FileJob, FileResult } from './read-file.ts';

interface Pending {
  resolve(results: FileResult[]): void;
  reject(error: Error): void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(from: Worker, error: Error): void {
  if (worker !== from) return;
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
  worker = null;
}

function settle(response: ParseResponse): void {
  const entry = pending.get(response.id);
  pending.delete(response.id);
  entry?.resolve(response.results);
  if (pending.size === 0) worker?.unref();
}

function startWorker(): Worker {
  const started = new Worker(new URL('./parse-worker.ts', import.meta.url));
  started.on('message', settle);
  started.on('error', (error) => failAll(started, error));
  started.on('exit', (code) =>
    failAll(started, new Error(`The parse worker exited with code ${code}.`)),
  );
  return started;
}

export function parseFiles(root: string, files: FileJob[]): Promise<FileResult[]> {
  worker ??= startWorker();
  worker.ref();
  const id = nextId++;
  const request: ParseRequest = { id, root, files };
  const result = new Promise<FileResult[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  worker.postMessage(request);
  return result;
}

export async function stopParseWorker(): Promise<void> {
  const running = worker;
  if (!running) return;
  failAll(running, new Error('The parse worker stopped.'));
  await running.terminate();
}
