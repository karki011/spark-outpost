import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTERNET_ZONE,
  markQuarantined,
  quarantineValue,
  zoneIdentifierStream,
} from './quarantine.ts';

describe('quarantineValue', () => {
  it('writes the downloaded flags, the time in hex, the app and the event id', () => {
    const value = quarantineValue(new Date(0x6000_0000 * 1000), 'Spark; Outpost', 'abc-def');
    expect(value).toBe('0081;60000000;Spark  Outpost;ABC-DEF');
  });
});

describe('zoneIdentifierStream', () => {
  it('names the Mark-of-the-Web stream beside the file', () => {
    expect(zoneIdentifierStream('C:\\Users\\me\\Downloads\\setup.exe')).toBe(
      'C:\\Users\\me\\Downloads\\setup.exe:Zone.Identifier',
    );
  });
});

describe.skipIf(process.platform !== 'win32')('markQuarantined on Windows', () => {
  it('marks a saved file as coming from the internet', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'spark-motw-'));
    try {
      const file = path.join(dir, 'setup.exe');
      await writeFile(file, 'MZ');
      expect(await markQuarantined(file, 'Spark Outpost')).toBe(true);
      expect(await readFile(zoneIdentifierStream(file), 'utf8')).toBe(INTERNET_ZONE);
      expect(await readFile(file, 'utf8')).toBe('MZ');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
