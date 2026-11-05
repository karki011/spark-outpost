import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileLog } from './file-log.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'spark-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = () => new Date('2026-10-01T12:00:00.000Z');
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');

describe('FileLog', () => {
  it('writes one stamped line per output line and creates the folder', () => {
    const logs = path.join(dir, 'nested', 'logs');
    const log = new FileLog({ dir: logs, now });
    log.write('api', 'API listening on http://127.0.0.1:4318\n\nsecond line');
    expect(readFileSync(log.file, 'utf8')).toBe(
      '2026-10-01T12:00:00.000Z [api] API listening on http://127.0.0.1:4318\n' +
        '2026-10-01T12:00:00.000Z [api] second line\n',
    );
    expect(statSync(log.file).mode & 0o777).toBe(0o600);
  });

  it('redacts keys, tokens and private key blocks before they reach the disk', () => {
    const log = new FileLog({ dir, now });
    log.write('worker', 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop1234567890');
    log.write('worker', 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    log.write('main', '-----BEGIN OPENSSH PRIVATE KEY-----');
    log.write('main', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ');
    log.write('main', '-----END OPENSSH PRIVATE KEY-----');
    log.write('main', 'after the key');
    const text = read('spark-outpost.log');
    expect(text).not.toMatch(/sk-ant|ghp_|b3BlbnNz/);
    expect(text).toContain('[redacted:');
    expect(text).toContain('[main] after the key');
  });

  it('rotates at the size cap and keeps a fixed number of files', () => {
    const log = new FileLog({ dir, now, maxBytes: 200, keep: 3 });
    for (let index = 0; index < 40; index += 1) log.write('main', `line ${index}`);
    expect(readdirSync(dir).sort()).toEqual([
      'spark-outpost.1.log',
      'spark-outpost.2.log',
      'spark-outpost.log',
    ]);
    for (const name of readdirSync(dir)) {
      expect(statSync(path.join(dir, name)).size).toBeLessThanOrEqual(200);
    }
    expect(read('spark-outpost.log')).toContain('line 39');
    expect(read('spark-outpost.1.log')).not.toContain('line 39');
  });

  it('continues an existing log after a restart and counts its size', () => {
    writeFileSync(path.join(dir, 'spark-outpost.log'), 'x'.repeat(190));
    const log = new FileLog({ dir, now, maxBytes: 200, keep: 2 });
    log.write('main', 'started again');
    expect(read('spark-outpost.1.log')).toBe('x'.repeat(190));
    expect(read('spark-outpost.log')).toContain('started again');
  });

  it('stops writing quietly when the folder cannot be used', () => {
    const blocker = path.join(dir, 'file');
    writeFileSync(blocker, '');
    const log = new FileLog({ dir: path.join(blocker, 'logs'), now });
    expect(() => log.write('main', 'hello')).not.toThrow();
    expect(() => log.write('main', 'again')).not.toThrow();
  });
});
