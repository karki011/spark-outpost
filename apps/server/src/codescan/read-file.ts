import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extensionOf, symbolLanguage } from './languages.ts';
import { looksBinary, looksGenerated } from './skip.ts';
import { extractSymbols, type Definition } from './symbols.ts';
import { isTestFile } from './test-pairs.ts';

export interface FileJob {
  path: string;
  knownHash: string | null;
}

export type FileResult =
  | { path: string; status: 'unchanged' }
  | { path: string; status: 'missing' }
  | {
      path: string;
      status: 'parsed';
      hash: string;
      lines: number;
      language: string;
      definitions: Definition[];
      references: string[];
    };

const BINARY_PROBE_BYTES = 8000;

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines += 1;
  }
  return text.endsWith('\n') ? lines - 1 : lines;
}

async function readBytes(root: string, path: string): Promise<Buffer | null> {
  try {
    return await readFile(join(root, path));
  } catch {
    return null;
  }
}

export async function readAndParse(root: string, job: FileJob): Promise<FileResult> {
  const bytes = await readBytes(root, job.path);
  if (!bytes) return { path: job.path, status: 'missing' };
  const hash = createHash('sha1').update(bytes).digest('hex');
  if (hash === job.knownHash) return { path: job.path, status: 'unchanged' };
  const base = { path: job.path, status: 'parsed' as const, hash };
  if (looksBinary(bytes.subarray(0, BINARY_PROBE_BYTES))) {
    return { ...base, lines: 0, language: 'binary', definitions: [], references: [] };
  }
  const text = bytes.toString('utf8');
  const lines = countLines(text);
  const language = symbolLanguage(job.path);
  if (!language || looksGenerated(text)) {
    const label = language ? 'generated' : extensionOf(job.path) || 'text';
    return { ...base, lines, language: label, definitions: [], references: [] };
  }
  const symbols = await extractSymbols(language, text, isTestFile(job.path));
  return { ...base, lines, language, ...symbols };
}
