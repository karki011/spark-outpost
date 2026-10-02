import { redacted, redactText, sensitiveFieldKind } from '@spark-outpost/contracts';
import type { ZipEntry } from './zip.ts';

export interface AboutFacts {
  appVersion: string | null;
  beta: boolean;
  electron: string | null;
  node: string;
  os: { platform: string; release: string; version: string; arch: string };
  processArch: string;
}

export interface ConnectionFact {
  name: string;
  connected: boolean;
  method: string | null;
}

export interface LogFile {
  name: string;
  text: string;
  truncated: boolean;
}

export interface DiagnosticsFacts {
  createdAt: Date;
  about: AboutFacts;
  providers: ConnectionFact[];
  advisors: ConnectionFact[];
  settings: Record<string, unknown>;
  desktopSettings: Record<string, unknown>;
  migrations: { applied: number; latest: string[] };
  desktopMarkers: Record<string, unknown>;
  logs: LogFile[];
}

const OMITTED_SETTINGS = new Set(['displayName']);

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const kind = sensitiveFieldKind(key);
    result[key] = kind ? redacted(kind) : redactValue(inner);
  }
  return result;
}

function json(value: unknown): string {
  return `${JSON.stringify(redactValue(value), null, 2)}\n`;
}

function shareableSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !OMITTED_SETTINGS.has(key)));
}

const README = `Spark Outpost diagnostics

This zip helps the Spark Outpost team understand a problem. It holds:

- about.json: app, Electron, Node and macOS versions and the processor type
- providers.json: which providers are connected and how (CLI or API key)
- settings.json: your settings, with your name left out and anything that looks like a key or token redacted
- migrations.json: which database updates have run, and the desktop update markers
- logs/: recent app logs, with keys and tokens redacted

It never holds chats, prompts, plans, file contents, keys or tokens. Open the files to check before you share them.
`;

export function diagnosticsEntries(facts: DiagnosticsFacts): ZipEntry[] {
  const entries: ZipEntry[] = [
    { name: 'README.txt', data: README },
    {
      name: 'about.json',
      data: json({ createdAt: facts.createdAt.toISOString(), ...facts.about }),
    },
    {
      name: 'providers.json',
      data: json({ providers: facts.providers, advisors: facts.advisors }),
    },
    {
      name: 'settings.json',
      data: json({
        profile: shareableSettings(facts.settings),
        desktop: facts.desktopSettings,
      }),
    },
    {
      name: 'migrations.json',
      data: json({ database: facts.migrations, desktop: facts.desktopMarkers }),
    },
  ];
  for (const log of facts.logs) {
    const note = log.truncated ? '[older lines left out]\n' : '';
    entries.push({ name: `logs/${log.name}`, data: note + redactText(log.text) });
  }
  return entries;
}
