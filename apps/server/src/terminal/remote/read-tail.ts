import { open } from 'node:fs/promises';

export const TAIL_BYTES = 768 * 1024;

export async function readTail(
  path: string,
  maxBytes = TAIL_BYTES,
): Promise<{ lines: string[]; truncated: boolean }> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return { lines: lines.filter((line) => line.trim()), truncated: start > 0 };
  } finally {
    await file.close();
  }
}
