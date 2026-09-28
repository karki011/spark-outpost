import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface VerifierTask {
  id: string;
  prompt: string;
  missed: string;
  hidden: string;
  correct: (repo: string) => Promise<void>;
  wrong: (repo: string) => Promise<void>;
}

export type Variant = 'correct' | 'wrong';

export interface VerifierCase {
  task: VerifierTask;
  variant: Variant;
}

export const TEST_HEAD = `import assert from 'node:assert/strict';
import test from 'node:test';
`;

export async function replaceLiteral(
  repo: string,
  file: string,
  from: string,
  to: string,
): Promise<void> {
  const path = join(repo, file);
  const text = await readFile(path, 'utf8');
  if (!text.includes(from)) throw new Error(`The edit did not apply to ${file}.`);
  await writeFile(
    path,
    text.replace(from, () => to),
  );
}
