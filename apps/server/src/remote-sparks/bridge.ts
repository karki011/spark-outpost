import {
  BROWSER_HOST_ENV,
  REMOTE_SPARKS_MAX,
  remoteSparkBridgeFromHostSchema,
  type RemoteSparkBridgeFromHost,
  type RemoteSparkBridgeToHost,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import {
  forgetSparkCookie,
  saveSparkAccess,
  saveSparkCookie,
  savedSparkAccess,
  savedSparkCookie,
} from './secrets.ts';
import { remoteSparkStatuses, type RemoteSparkState } from './status.ts';
import { listRemoteSparks, remoteSpark } from './store.ts';

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

interface RemoteSparkLinkDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
}

export interface RemoteSparkLink {
  port: RemoteSparkPort | null;
  stateOf(id: string, paired: boolean): RemoteSparkState;
  forget(id: string): Promise<void>;
  forgetAll(): Promise<void>;
}

type WatchedSparks = Extract<RemoteSparkBridgeToHost, { kind: 'remote-spark:watch' }>['sparks'];

async function watchedSparks(deps: RemoteSparkLinkDeps): Promise<WatchedSparks> {
  const watched: WatchedSparks = [];
  for (const row of await listRemoteSparks(deps.db, deps.workspaceId)) {
    if (watched.length === REMOTE_SPARKS_MAX) break;
    const cookie = await savedSparkCookie(deps.secrets, row.id);
    if (cookie === null) continue;
    const access = await savedSparkAccess(deps.secrets, row.id);
    watched.push({ id: row.id, hostname: row.hostname, cookie, access });
  }
  return watched;
}

export function linkRemoteSparks(
  deps: RemoteSparkLinkDeps,
  port: RemoteSparkPort | null,
): RemoteSparkLink {
  const statuses = remoteSparkStatuses();
  let sending: Promise<void> = Promise.resolve();
  let receiving: Promise<void> = Promise.resolve();

  const sendWatch = (): Promise<void> => {
    if (!port) return Promise.resolve();
    sending = sending
      .then(async () => {
        port.post({ kind: 'remote-spark:watch', sparks: await watchedSparks(deps) });
      })
      .catch(() => {
        console.error('Could not tell the desktop app which saved Sparks to watch.');
      });
    return sending;
  };

  const receive = async (message: RemoteSparkBridgeFromHost): Promise<void> => {
    if (message.kind === 'remote-spark:signed-out') {
      await forgetSparkCookie(deps.secrets, message.id);
      statuses.drop(message.id);
      await sendWatch();
      return;
    }
    const saved = await remoteSpark(deps.db, deps.workspaceId, message.id);
    if (!saved) return;
    if (message.kind === 'remote-spark:status') {
      statuses.report(message.id, message);
      return;
    }
    if (saved.hostname !== message.hostname.toLowerCase()) return;
    if (message.kind === 'remote-spark:access') {
      if ((await savedSparkAccess(deps.secrets, message.id)) === message.value) return;
      await saveSparkAccess(deps.secrets, message.id, message.value);
      await sendWatch();
      return;
    }
    if ((await savedSparkCookie(deps.secrets, message.id)) === message.value) return;
    await saveSparkCookie(deps.secrets, message.id, message.value);
    statuses.drop(message.id);
    await sendWatch();
  };

  if (port) {
    port.subscribe((raw) => {
      const parsed = remoteSparkBridgeFromHostSchema.safeParse(raw);
      if (!parsed.success) return;
      receiving = receiving
        .then(() => receive(parsed.data))
        .catch(() => {
          console.error('Could not update a saved Spark from the desktop app.');
        });
    });
    void sendWatch();
  }

  return {
    port,
    stateOf: (id, paired) => statuses.of(id, paired),
    forget: (id) => {
      statuses.drop(id);
      return sendWatch();
    },
    forgetAll: () => {
      statuses.clear();
      return sendWatch();
    },
  };
}
