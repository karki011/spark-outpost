import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readAgentInstructions } from './agent-instructions.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spark-instructions-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('combines inline text with the current file without caching file content', async () => {
  const file = join(root, 'instructions.md');
  await writeFile(file, 'Write small changes.');
  expect(await readAgentInstructions('  Be concise. ', file)).toBe(
    'Be concise.\n\nWrite small changes.',
  );
  await writeFile(file, 'Check accessibility.');
  expect(await readAgentInstructions('', file)).toBe('Check accessibility.');
  expect(await readAgentInstructions('Text only', '')).toBe('Text only');
});

it('rejects missing, relative, oversized, binary and directory instruction files', async () => {
  await expect(readAgentInstructions('', 'relative.md')).rejects.toThrow('absolute');
  await expect(readAgentInstructions('', join(root, 'missing.md'))).rejects.toThrow(
    'could not be read',
  );
  const file = join(root, 'instructions.md');
  await writeFile(file, 'x'.repeat(16_001));
  await expect(readAgentInstructions('', file)).rejects.toThrow('16 KB');
  await writeFile(file, Buffer.from([0xff, 0xfe]));
  await expect(readAgentInstructions('', file)).rejects.toThrow('could not be read');
  await writeFile(file, 'hello\0world');
  await expect(readAgentInstructions('', file)).rejects.toThrow('UTF-8');
  const directory = join(root, 'folder');
  await mkdir(directory);
  await expect(readAgentInstructions('', directory)).rejects.toThrow('UTF-8');
});

it('rejects secret paths including a symlink target without returning contents', async () => {
  const secret = join(root, '.env');
  const link = join(root, 'instructions.md');
  await writeFile(secret, 'PRIVATE_VALUE=never-show');
  await symlink(secret, link);
  for (const path of [secret, link]) {
    await expect(readAgentInstructions('', path)).rejects.toThrow('not a secret file');
  }
});
