import { open } from 'node:fs/promises';
import { completeLines } from '../native-tail.ts';

const TAIL_BYTES = 768 * 1024;

export interface Tail {
  lines: string[];
  truncated: boolean;
  size: number;
  modified: number;
}

export async function readTail(path: string): Promise<Tail> {
  const file = await open(path, 'r');
  try {
    const { size, mtimeMs } = await file.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.allocUnsafe(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const { lines } = completeLines(buffer.subarray(0, bytesRead));
    if (start > 0) lines.shift();
    return { lines, truncated: start > 0, size, modified: mtimeMs };
  } finally {
    await file.close();
  }
}
