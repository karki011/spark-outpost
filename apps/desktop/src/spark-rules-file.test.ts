import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRulesFile } from './spark-rules-file.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-rules-open-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('opening settings.json', () => {
  it('opens the file when it is there', async () => {
    const file = path.join(dir, 'settings.json');
    await writeFile(file, '{}');
    const opened: string[] = [];
    const result = await openRulesFile(file, async (target) => {
      opened.push(target);
      return '';
    });
    expect(result).toEqual({ opened: true });
    expect(opened).toEqual([file]);
  });

  it('opens nothing and says so when the file is gone', async () => {
    const open = vi.fn(async () => '');
    const result = await openRulesFile(path.join(dir, 'settings.json'), open);
    expect(result).toMatchObject({ opened: false });
    expect(open).not.toHaveBeenCalled();
  });

  it('passes on what macOS reports when the file cannot be opened', async () => {
    const file = path.join(dir, 'settings.json');
    await writeFile(file, '{}');
    const result = await openRulesFile(file, async () => 'No application knows how to open it');
    expect(result).toEqual({ opened: false, error: 'No application knows how to open it' });
  });
});
