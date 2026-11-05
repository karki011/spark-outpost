import { describe, expect, it } from 'vitest';
import { diagnosticsEntries, redactValue, type DiagnosticsFacts } from './report.ts';

const KEY = 'sk-ant-api03-abcdefghijklmnop1234567890';
const GITHUB = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

function facts(patch: Partial<DiagnosticsFacts> = {}): DiagnosticsFacts {
  return {
    createdAt: new Date('2026-10-01T12:00:00Z'),
    about: {
      appVersion: '0.1.0-beta.1',
      beta: true,
      electron: '44.4.5',
      node: '24.10.0',
      os: { platform: 'darwin', release: '24.6.0', version: 'Darwin 24.6.0', arch: 'x64' },
      processArch: 'x64',
    },
    providers: [{ name: 'Claude', connected: true, method: 'cli' }],
    advisors: [{ name: 'Jev', connected: false, method: null }],
    settings: { displayName: 'Hari Example', personality: 'warm', apiKey: KEY },
    desktopSettings: { 'updates.json': { channel: 'beta', autoDownload: true } },
    migrations: { applied: 92, latest: ['0092_last.sql'] },
    desktopMarkers: { 'migrated-version.json': { version: '0.1.0-beta.1' } },
    eventLoop: [
      '2026-10-01T11:59:00.000Z [api] Event loop blocked for 850 ms in the API during GET /api/x',
    ],
    logs: [
      {
        name: 'spark-outpost.log',
        text: `[api] started\n[worker] Authorization: Bearer ${GITHUB}\nANTHROPIC_API_KEY=${KEY}\n`,
        truncated: true,
      },
    ],
    ...patch,
  };
}

function files(input: DiagnosticsFacts): Map<string, string> {
  return new Map(diagnosticsEntries(input).map((entry) => [entry.name, String(entry.data)]));
}

describe('diagnosticsEntries', () => {
  it('holds the versions, provider methods, settings, migrations and logs', () => {
    const zip = files(facts());
    expect([...zip.keys()]).toEqual([
      'README.txt',
      'about.json',
      'providers.json',
      'settings.json',
      'migrations.json',
      'event-loop.json',
      'logs/spark-outpost.log',
    ]);
    expect(JSON.parse(zip.get('about.json')!)).toMatchObject({
      appVersion: '0.1.0-beta.1',
      beta: true,
      electron: '44.4.5',
      os: { arch: 'x64' },
    });
    expect(JSON.parse(zip.get('providers.json')!)).toEqual({
      providers: [{ name: 'Claude', connected: true, method: 'cli' }],
      advisors: [{ name: 'Jev', connected: false, method: null }],
    });
    expect(JSON.parse(zip.get('migrations.json')!)).toMatchObject({
      database: { applied: 92 },
      desktop: { 'migrated-version.json': { version: '0.1.0-beta.1' } },
    });
    expect(JSON.parse(zip.get('event-loop.json')!)).toEqual({
      warnAfterMs: 200,
      warnings: [expect.stringContaining('blocked for 850 ms in the API during GET /api/x')],
    });
    expect(zip.get('logs/spark-outpost.log')).toMatch(/^\[older lines left out\]\n\[api\] started/);
  });

  it('leaves out the user name and every key or token', () => {
    const everything = [...files(facts()).values()].join('\n');
    expect(everything).not.toContain('Hari Example');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(GITHUB);
    expect(everything).toContain('[redacted:');
    const settings = JSON.parse(files(facts()).get('settings.json')!) as {
      profile: Record<string, unknown>;
    };
    expect(settings.profile).toEqual({ personality: 'warm', apiKey: '[redacted:api_key]' });
  });
});

describe('redactValue', () => {
  it('redacts secret-named fields and secret-shaped strings at any depth', () => {
    expect(
      redactValue({
        servers: [{ name: 'linear', env: { token: 'abc' }, url: `https://u:${GITHUB}@x.dev` }],
        note: `uses ${KEY}`,
        count: 3,
      }),
    ).toEqual({
      servers: [
        {
          name: 'linear',
          env: { token: '[redacted:token]' },
          url: 'https://u:[redacted:url_password]@x.dev',
        },
      ],
      note: 'uses [redacted:api_key]',
      count: 3,
    });
  });
});
