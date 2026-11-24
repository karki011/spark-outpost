import { open } from 'node:fs/promises';
import { completeLines } from '../native-tail.ts';

const TAIL_BYTES = 768 * 1024;

export interface Tail {
  lines: string[];
  truncated: boolean;
  size: number;
  modified: number;
  offset: number;
  appended: boolean;
}

export async function readTail(path: string, from: number | null = null): Promise<Tail> {
  const file = await open(path, 'r');
  try {
    const { size, mtimeMs } = await file.stat();
    const appended = from !== null && from <= size && size - from <= TAIL_BYTES;
    const start = appended ? from : Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.allocUnsafe(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const { lines, rest } = completeLines(buffer.subarray(0, bytesRead));
    if (!appended && start > 0) lines.shift();
    return {
      lines,
      truncated: !appended && start > 0,
      size,
      modified: mtimeMs,
      offset: start + bytesRead - rest.length,
      appended,
    };
  } finally {
    await file.close();
  }
}
