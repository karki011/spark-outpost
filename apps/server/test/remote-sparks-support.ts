import type { RemoteSparkBridgeToHost } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import type { RemoteSparkPort } from '../src/remote-sparks/bridge.ts';
import { remoteSparkSecret, type SecretStore } from '../src/setup/secrets.ts';
import { testAppOptions } from './app-support.ts';
import type { TestDb } from './support.ts';

export const THIS_MAC = 'Desk Mac';
export const STUDIO = 'studio.tail1234.ts.net';
export const STUDIO_COOKIE = `studio-device-cookie-${'c'.repeat(43)}`;

type WatchMessage = Extract<RemoteSparkBridgeToHost, { kind: 'remote-spark:watch' }>;
type WindowMessage = Exclude<RemoteSparkBridgeToHost, WatchMessage>;

export interface FakeDesktop extends RemoteSparkPort {
  posted: WindowMessage[];
  watched: WatchMessage['sparks'][];
  send(message: unknown): void;
}

export function fakeDesktop(): FakeDesktop {
  const listeners: ((message: unknown) => void)[] = [];
  const posted: WindowMessage[] = [];
  const watched: WatchMessage['sparks'][] = [];
  return {
    posted,
    watched,
    post: (message) => {
      if (message.kind === 'remote-spark:watch') watched.push(message.sparks);
      else posted.push(message);
    },
    subscribe: (listener) => listeners.push(listener),
    send: (message) => listeners.forEach((listener) => listener(message)),
  };
}

export function sparkApp(t: TestDb, secrets: SecretStore, desktop: FakeDesktop | null) {
  return createApp({
    ...testAppOptions(t, { secrets }),
    remoteSparkPort: desktop,
    thisMacName: `${THIS_MAC}.local`,
  });
}

export function cookieIn(secrets: SecretStore, id: string): Promise<string | null> {
  return secrets.get(remoteSparkSecret(id));
}

export async function everyRow(t: TestDb): Promise<string> {
  const { rows } = await t.db.query<{ dump: string }>(
    `SELECT (SELECT coalesce(json_agg(s), '[]')::text FROM remote_sparks s) ||
            (SELECT coalesce(json_agg(a), '[]')::text FROM remote_audit a) AS dump`,
  );
  return rows[0]!.dump;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngBytes(width: number, height: number, filler = 0): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(13, 0);
  header.write('IHDR', 4, 'latin1');
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), header, Buffer.alloc(32, filler)]);
}

export function iconBody(bytes: Buffer): { png: string } {
  return { png: bytes.toString('base64') };
}
