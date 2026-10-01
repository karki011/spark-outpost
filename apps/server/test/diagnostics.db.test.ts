import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateProfile } from '../src/persistence/setup.ts';
import { recentLogs } from '../src/diagnostics/collect.ts';
import { LOCAL_HEADERS, createTestApp } from './app-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';
import { unzipText } from './unzip.ts';

const CHAT_TEXT = 'Please refactor the secret billing module for Project Nightingale';
const KEY = 'sk-ant-api03-zyxwvutsrqponmlk9876543210';

let t: TestDb;
let dir: string;

beforeEach(async () => {
  t = await createTestDb();
  dir = mkdtempSync(path.join(os.tmpdir(), 'spark-diagnostics-'));
});

afterEach(async () => {
  await t.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function desktopFolders() {
  const logDir = path.join(dir, 'logs');
  mkdirSync(logDir);
  writeFileSync(
    path.join(logDir, 'spark-outpost.log'),
    `2026-10-01T12:00:00.000Z [api] ANTHROPIC_API_KEY=${KEY}\n`,
  );
  writeFileSync(path.join(logDir, 'spark-outpost.1.log'), '2026-10-01T11:00:00.000Z [main] ok\n');
  writeFileSync(path.join(logDir, 'notes.txt'), 'not a log');
  writeFileSync(path.join(dir, 'updates.json'), '{"channel":"beta","autoDownload":true}');
  writeFileSync(path.join(dir, 'migrated-version.json'), '{"version":"0.1.0-beta.1"}');
  return { appVersion: '0.1.0-beta.1', logDir, dataDir: dir };
}

describe('GET /api/diagnostics/export', () => {
  it('saves versions, providers, settings, migrations and logs without chats or keys', async () => {
    await updateProfile(t.db, t.workspaceId, { displayName: 'Ada Lovelace' });
    await connectCliProvider(t, 'claude');
    await startChat(t, `${CHAT_TEXT} using ${KEY}`);
    const app = createTestApp(t, { diagnostics: desktopFolders() });

    const response = await request(app)
      .get('/api/diagnostics/export')
      .set(LOCAL_HEADERS)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="spark-outpost-diagnostics-\d{4}-\d{2}-\d{2}-\d{6}\.zip"/,
    );
    const files = unzipText(response.body as Buffer);
    expect([...files.keys()]).toEqual([
      'README.txt',
      'about.json',
      'providers.json',
      'settings.json',
      'migrations.json',
      'logs/spark-outpost.1.log',
      'logs/spark-outpost.log',
    ]);
    const providers = JSON.parse(files.get('providers.json')!) as {
      providers: { name: string; connected: boolean; method: string | null }[];
    };
    expect(providers.providers).toContainEqual({ name: 'Claude', connected: true, method: 'cli' });
    const migrations = JSON.parse(files.get('migrations.json')!) as {
      database: { applied: number };
      desktop: Record<string, unknown>;
    };
    expect(migrations.database.applied).toBeGreaterThan(0);
    expect(migrations.desktop).toEqual({ 'migrated-version.json': { version: '0.1.0-beta.1' } });
    expect(JSON.parse(files.get('settings.json')!)).toMatchObject({
      desktop: { 'updates.json': { channel: 'beta' } },
    });

    const everything = [...files.values()].join('\n');
    expect(everything).not.toContain('Nightingale');
    expect(everything).not.toContain('Ada Lovelace');
    expect(everything).not.toContain(KEY);
    expect(everything).toContain('ANTHROPIC_API_KEY=[redacted:api_key]');
  });

  it('exports without desktop folders in the browser setup', async () => {
    const response = await request(createTestApp(t))
      .get('/api/diagnostics/export')
      .set(LOCAL_HEADERS)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const files = unzipText(response.body as Buffer);
    expect([...files.keys()].some((name) => name.startsWith('logs/'))).toBe(false);
    expect(JSON.parse(files.get('about.json')!)).toMatchObject({ appVersion: null, beta: false });
  });
});

describe('recentLogs', () => {
  it('keeps only the newest bytes of a large log and says so', async () => {
    writeFileSync(path.join(dir, 'big.log'), `${'old line\n'.repeat(100)}newest line\n`);
    const [log] = await recentLogs(dir, 20);
    expect(log).toMatchObject({ name: 'big.log', truncated: true });
    expect(log!.text.endsWith('newest line\n')).toBe(true);
    expect(log!.text.length).toBe(20);
  });
});
