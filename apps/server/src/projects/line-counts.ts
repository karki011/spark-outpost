import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 1024 * 1024;

export interface LineCounts {
  added: number;
  removed: number;
}

export function lineCount(content: Buffer | null): number {
  if (content === null || content.length === 0) return 0;
  let count = 0;
  for (const byte of content) if (byte === 10) count++;
  return content.at(-1) === 10 ? count : count + 1;
}

function diffNumstat(before: string, after: string): Promise<string> {
  const args = ['diff', '--no-index', '--no-renames', '--numstat', '--', before, after];
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout) => {
      if (error && error.code !== 1) reject(error);
      else resolve(stdout);
    });
  });
}

export function parseCounts(numstat: string): LineCounts {
  const [added, removed] = numstat.trim().split('\t');
  return { added: Number(added) || 0, removed: Number(removed) || 0 };
}

export async function countChangedLines(
  before: Buffer | null,
  after: Buffer | null,
): Promise<LineCounts> {
  if (before === null) return { added: lineCount(after), removed: 0 };
  if (after === null) return { added: 0, removed: lineCount(before) };
  const scratch = await mkdtemp(path.join(tmpdir(), 'spark-outpost-count-'));
  try {
    const oldFile = path.join(scratch, 'old');
    const newFile = path.join(scratch, 'new');
    await Promise.all([writeFile(oldFile, before), writeFile(newFile, after)]);
    return parseCounts(await diffNumstat(oldFile, newFile));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
