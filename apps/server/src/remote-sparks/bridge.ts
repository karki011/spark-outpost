import {
  BROWSER_HOST_ENV,
  remoteSparkBridgeFromHostSchema,
  type RemoteSparkBridgeToHost,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { forgetSparkCookie, saveSparkCookie } from './secrets.ts';
import { remoteSpark } from './store.ts';

export interface RemoteSparkPort {
  post(message: RemoteSparkBridgeToHost): void;
  subscribe(listener: (message: unknown) => void): void;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export function connectRemoteSparkPort(
  env: NodeJS.ProcessEnv,
  owner: object,
): RemoteSparkPort | null {
  const parent = (owner as { parentPort?: ParentPort }).parentPort;
  if (env[BROWSER_HOST_ENV] !== '1' || !parent) return null;
  return {
    post: (message) => parent.postMessage(message),
    subscribe: (listener) => parent.on('message', (event) => listener(event.data)),
  };
}

interface RemoteSparkCaptureDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
}

async function receiveFromHost(deps: RemoteSparkCaptureDeps, raw: unknown): Promise<void> {
  const parsed = remoteSparkBridgeFromHostSchema.safeParse(raw);
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.kind === 'remote-spark:signed-out') {
    await forgetSparkCookie(deps.secrets, message.id);
    return;
  }
  const saved = await remoteSpark(deps.db, deps.workspaceId, message.id);
  if (!saved || saved.hostname !== message.hostname.toLowerCase()) return;
  await saveSparkCookie(deps.secrets, message.id, message.value);
}

export function captureRemoteSparkCookies(
  deps: RemoteSparkCaptureDeps,
  port: RemoteSparkPort,
): void {
  port.subscribe((raw) => {
    receiveFromHost(deps, raw).catch(() => {
      console.error('Could not update a saved Spark sign-in in the keychain.');
    });
  });
}
