import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUCTIONS_FILE_MAX_BYTES, TEAMMATE_INSTRUCTIONS_MAX } from '@spark-outpost/contracts';
import { listFolders } from './folders.ts';
import { briefWithFile, readInstructionsFile } from './instructions-file.ts';

let root: string;
const at = (name: string) => path.join(root, name);

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-instructions-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readInstructionsFile', () => {
  it('returns the trimmed text with its size', async () => {
    await writeFile(at('reviewer.md'), '\n# Reviewer\nName the file and line.\n');
    expect(await readInstructionsFile(at('reviewer.md'))).toEqual({
      path: at('reviewer.md'),
      name: 'reviewer.md',
      sizeBytes: 36,
      text: '# Reviewer\nName the file and line.',
      truncated: false,
      problem: null,
    });
  });

  it('cuts long files at the standing-instructions limit and says so', async () => {
    await writeFile(at('long.txt'), 'x'.repeat(TEAMMATE_INSTRUCTIONS_MAX + 500));
    const file = await readInstructionsFile(at('long.txt'));
    expect(file.text).toHaveLength(TEAMMATE_INSTRUCTIONS_MAX);
    expect(file.truncated).toBe(true);
    expect(file.problem).toBeNull();
  });

  it('refuses secret names, other file types and relative paths without reading them', async () => {
    await writeFile(at('.env'), 'TOKEN=abc');
    await writeFile(at('credentials.md'), 'key');
    await writeFile(at('notes.json'), '{}');
    for (const name of ['.env', 'credentials.md']) {
      const file = await readInstructionsFile(at(name));
      expect(file.problem).toBe('Secret files can’t be used as instructions.');
      expect(file.text).toBe('');
    }
    expect((await readInstructionsFile(at('notes.json'))).problem).toContain('Markdown or text');
    expect((await readInstructionsFile('roles/reviewer.md')).problem).toBe(
      'Choose a file by its full path.',
    );
  });

  it('refuses a text-named link that points at a secret or another file type', async () => {
    await writeFile(at('.env'), 'TOKEN=abc');
    await writeFile(at('id_rsa'), 'PRIVATE');
    await symlink(at('.env'), at('env.md'));
    await symlink(at('id_rsa'), at('key.txt'));
    expect((await readInstructionsFile(at('env.md'))).problem).toContain('Secret files');
    const key = await readInstructionsFile(at('key.txt'));
    expect(key.problem).toContain('Secret files');
    expect(key.text).toBe('');
  });

  it('reports missing, oversized, binary and folder paths', async () => {
    await writeFile(at('big.md'), Buffer.alloc(INSTRUCTIONS_FILE_MAX_BYTES + 1, 'a'));
    await writeFile(at('image.md'), Buffer.from([0x89, 0x50, 0x00, 0xff]));
    await writeFile(at('latin.txt'), Buffer.from([0xff, 0xfe, 0xfd]));
    await mkdir(at('folder.md'));
    expect((await readInstructionsFile(at('gone.md'))).problem).toBe('This file is missing.');
    expect((await readInstructionsFile(at('big.md'))).problem).toContain('larger than 256 KB');
    expect((await readInstructionsFile(at('image.md'))).problem).toContain('not plain text');
    expect((await readInstructionsFile(at('latin.txt'))).problem).toContain('not plain text');
    expect((await readInstructionsFile(at('folder.md'))).problem).toBe('That path is not a file.');
  });
});

describe('briefWithFile', () => {
  const brief = { name: 'Pip', role: 'Reviewer', instructions: 'Typed.', instructionsPath: null };

  it('uses the file instead of typed text and reads it again each time', async () => {
    await writeFile(at('role.md'), 'From the file.');
    const withFile = { ...brief, instructionsPath: at('role.md') };
    expect(await briefWithFile(withFile)).toEqual({
      name: 'Pip',
      role: 'Reviewer',
      instructions: 'From the file.',
    });
    await writeFile(at('role.md'), 'Edited.');
    expect((await briefWithFile(withFile)).instructions).toBe('Edited.');
  });

  it('falls back to the typed instructions when the file is missing, empty or fails', async () => {
    await writeFile(at('empty.md'), '  \n');
    expect((await briefWithFile(brief)).instructions).toBe('Typed.');
    expect((await briefWithFile({ ...brief, instructionsPath: at('gone.md') })).instructions).toBe(
      'Typed.',
    );
    expect((await briefWithFile({ ...brief, instructionsPath: at('empty.md') })).instructions).toBe(
      'Typed.',
    );
    const failing = () => Promise.reject(new Error('disk'));
    expect(
      (await briefWithFile({ ...brief, instructionsPath: at('role.md') }, failing)).instructions,
    ).toBe('Typed.');
  });
});

describe('listFolders with instruction files', () => {
  beforeEach(async () => {
    await mkdir(at('roles'));
    await mkdir(at('.claude'));
    await writeFile(at('Reviewer.md'), 'a');
    await writeFile(at('notes.txt'), 'bb');
    await writeFile(at('data.json'), '{}');
    await writeFile(at('.env'), 'TOKEN=abc');
    await writeFile(at('credentials.txt'), 'secret');
    await writeFile(at('.hidden.md'), 'h');
    await symlink(at('notes.txt'), at('alias.md'));
  });

  it('lists no files unless asked', async () => {
    const listing = await listFolders(root);
    expect(listing.files).toEqual([]);
    expect(listing.folders.map((folder) => folder.name)).toEqual(['roles']);
  });

  it('lists visible Markdown and text files with sizes, never secrets', async () => {
    const listing = await listFolders(root, { instructionFiles: true });
    expect(listing.files).toEqual([
      { name: 'alias.md', path: at('alias.md'), sizeBytes: 2 },
      { name: 'notes.txt', path: at('notes.txt'), sizeBytes: 2 },
      { name: 'Reviewer.md', path: at('Reviewer.md'), sizeBytes: 1 },
    ]);
  });

  it('adds hidden folders and files when asked, still without secrets', async () => {
    const listing = await listFolders(root, { instructionFiles: true, hidden: true });
    expect(listing.folders.map((folder) => folder.name)).toEqual(['.claude', 'roles']);
    expect(listing.files.map((file) => file.name)).toEqual([
      '.hidden.md',
      'alias.md',
      'notes.txt',
      'Reviewer.md',
    ]);
  });
});
