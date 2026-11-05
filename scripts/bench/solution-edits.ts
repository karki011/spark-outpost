import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function replace(repo: string, file: string, from: string | RegExp, to: string) {
  const path = join(repo, file);
  const text = await readFile(path, 'utf8');
  const next = text.replace(from, to);
  if (next === text) throw new Error(`Reference edit did not apply to ${file}.`);
  await writeFile(path, next);
}

export async function append(repo: string, file: string, text: string) {
  const path = join(repo, file);
  await writeFile(path, (await readFile(path, 'utf8')) + text);
}
