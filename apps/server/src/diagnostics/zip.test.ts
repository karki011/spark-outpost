import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipText } from '../../test/unzip.ts';
import { zipFiles } from './zip.ts';

describe('zipFiles', () => {
  const entries = [
    { name: 'README.txt', data: 'hello\n' },
    { name: 'logs/spark-outpost.log', data: 'line one\nline two — ünïcode\n'.repeat(200) },
    { name: 'empty.json', data: Buffer.alloc(0) },
  ];

  it('writes every file so it reads back unchanged', () => {
    const files = unzipText(zipFiles(entries));
    expect([...files.keys()]).toEqual(['README.txt', 'logs/spark-outpost.log', 'empty.json']);
    expect(files.get('logs/spark-outpost.log')).toBe(entries[1]!.data);
    expect(files.get('empty.json')).toBe('');
  });

  it('passes the system unzip integrity test', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'spark-zip-'));
    try {
      const file = path.join(dir, 'test.zip');
      writeFileSync(file, zipFiles(entries));
      expect(execFileSync('unzip', ['-t', file], { encoding: 'utf8' })).toContain(
        'No errors detected',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
