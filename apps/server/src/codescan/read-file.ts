import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractEndpoints, type Endpoint } from './endpoints.ts';
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
      imports: string[];
      endpoints: Endpoint[];
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
  const empty = { definitions: [], references: [], imports: [] };
  if (looksBinary(bytes.subarray(0, BINARY_PROBE_BYTES))) {
    return { ...base, ...empty, lines: 0, language: 'binary', endpoints: [] };
  }
  const text = bytes.toString('utf8');
  const lines = countLines(text);
  const language = symbolLanguage(job.path);
  if (!language) {
    const endpoints = extractEndpoints(job.path, text, null, []);
    return { ...base, ...empty, lines, language: extensionOf(job.path) || 'text', endpoints };
  }
  if (looksGenerated(text)) {
    const endpoints = extractEndpoints(job.path, text, language, []);
    return { ...base, ...empty, lines, language: 'generated', endpoints };
  }
  const symbols = await extractSymbols(language, text, isTestFile(job.path));
  const endpoints = extractEndpoints(job.path, text, language, symbols.imports);
  return { ...base, lines, language, ...symbols, endpoints };
}
