import { statSync, unwatchFile, watchFile } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

const NEWLINE = 0x0a;
const POLL_MS = 200;

export interface TranscriptWatcher {
  ready: Promise<void>;
  flush(): Promise<void>;
  offset(): number | null;
  close(): void;
}

export type WatchTranscript = (
  path: string,
  from: number | null,
  onLines: (lines: string[]) => Promise<void>,
) => TranscriptWatcher | null;

export function completeLines(data: Buffer): { lines: string[]; rest: Buffer } {
  const end = data.lastIndexOf(NEWLINE);
  if (end < 0) return { lines: [], rest: data };
  const lines = data
    .subarray(0, end)
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  return { lines, rest: data.subarray(end + 1) };
}

export const watchTranscript: WatchTranscript = (path, from, onLines) => {
  let offset = from;
  let rest: Buffer = Buffer.alloc(0);
  let closed = false;
  const read = async () => {
    const file = await open(path, 'r').catch(() => null);
    if (!file) {
      offset ??= 0;
      return;
    }
    try {
      const { size } = await file.stat();
      if (offset === null || size < offset) {
        offset = size;
        rest = Buffer.alloc(0);
        return;
      }
      if (size === offset) return;
      const added = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(added, 0, added.length, offset);
      offset += bytesRead;
      const parsed = completeLines(Buffer.concat([rest, added.subarray(0, bytesRead)]));
      rest = parsed.rest;
      if (parsed.lines.length > 0) void onLines(parsed.lines).catch(() => undefined);
    } finally {
      await file.close();
    }
  };
  let chain = Promise.resolve();
  const queue = () => {
    chain = chain.then(() => (closed ? undefined : read())).catch(() => undefined);
    return chain;
  };
  try {
    if (!statSync(dirname(path)).isDirectory()) return null;
  } catch {
    return null;
  }
  const onChange = () => void queue();
  watchFile(path, { interval: POLL_MS, persistent: false }, onChange);
  const ready = queue();
  return {
    ready,
    flush: queue,
    offset: () => (offset === null ? null : offset - rest.length),
    close() {
      closed = true;
      unwatchFile(path, onChange);
    },
  };
};
