import type { Session } from 'electron';
import {
  attentionListSchema,
  REMOTE_DEVICE_COOKIE,
  REMOTE_SPARK_WATCH_MS,
  remoteNeedsYou,
  remoteSparkOrigin,
  type RemoteSparkBridgeFromHost,
  type RemoteSparkBridgeToHost,
} from '@spark-outpost/contracts';
import { deviceCookie } from './cookie.ts';
import { remoteSparkSession, type RemoteSparkGuards } from './partition.ts';

export const REMOTE_SPARK_CHECK_TIMEOUT_MS = 10_000;

export type WatchedSpark = Extract<
  RemoteSparkBridgeToHost,
  { kind: 'remote-spark:watch' }
>['sparks'][number];

type Reach = Pick<
  Extract<RemoteSparkBridgeFromHost, { kind: 'remote-spark:status' }>,
  'status' | 'needsYou'
>;

export interface RemoteSparkWatcherHooks {
  guards: RemoteSparkGuards;
  status(id: string, reach: Reach): void;
  signedOut(id: string): void;
}

export interface RemoteSparkWatcher {
  watch(sparks: readonly WatchedSpark[]): void;
  forget(id: string): void;
  stop(): void;
}

interface Watched {
  hostname: string;
  cookie: string;
  target: Session;
  timer: ReturnType<typeof setInterval>;
  checking: boolean;
  stopped: boolean;
  sent: Reach | null;
}

const OFFLINE: Reach = { status: 'offline', needsYou: 0 };

async function holdsCookie(target: Session, hostname: string): Promise<boolean> {
  const held = await target.cookies.get({
    url: remoteSparkOrigin(hostname),
    name: REMOTE_DEVICE_COOKIE,
  });
  return held.length > 0;
}

async function ask(target: Session, hostname: string): Promise<Reach | 'signed-out'> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REMOTE_SPARK_CHECK_TIMEOUT_MS);
  try {
    const response = await target.fetch(`${remoteSparkOrigin(hostname)}/api/attention`, {
      credentials: 'include',
      signal: abort.signal,
    });
    if (response.status === 401) return 'signed-out';
    if (response.status !== 200) return OFFLINE;
    const list = attentionListSchema.safeParse(await response.json());
    return list.success ? { status: 'online', needsYou: remoteNeedsYou(list.data) } : OFFLINE;
  } catch {
    return OFFLINE;
  } finally {
    clearTimeout(timeout);
  }
}

async function reachOf(watched: Watched): Promise<Reach | 'signed-out'> {
  try {
    if (!(await holdsCookie(watched.target, watched.hostname))) {
      await watched.target.cookies.set(deviceCookie(watched.hostname, watched.cookie));
    }
  } catch {
    return OFFLINE;
  }
  if (watched.stopped) return OFFLINE;
  return ask(watched.target, watched.hostname);
}

export function startRemoteSparkWatcher(hooks: RemoteSparkWatcherHooks): RemoteSparkWatcher {
  const watching = new Map<string, Watched>();

  const end = (id: string, watched: Watched) => {
    watched.stopped = true;
    clearInterval(watched.timer);
    if (watching.get(id) === watched) watching.delete(id);
  };

  const signedOut = (id: string, watched: Watched) => {
    end(id, watched);
    hooks.signedOut(id);
    watched.target.cookies
      .remove(remoteSparkOrigin(watched.hostname), REMOTE_DEVICE_COOKIE)
      .catch(() => hooks.guards.log('Could not remove a refused remote Spark sign-in.'));
  };

  const check = async (id: string, watched: Watched) => {
    if (watched.checking || watched.stopped) return;
    watched.checking = true;
    const reach = await reachOf(watched);
    watched.checking = false;
    if (watched.stopped) return;
    if (reach === 'signed-out') {
      signedOut(id, watched);
      return;
    }
    const { sent } = watched;
    if (sent && sent.status === reach.status && sent.needsYou === reach.needsYou) return;
    watched.sent = reach;
    hooks.status(id, reach);
  };

  const start = ({ id, hostname, cookie }: WatchedSpark) => {
    const watched: Watched = {
      hostname,
      cookie,
      target: remoteSparkSession(id, hostname, hooks.guards),
      timer: setInterval(() => void check(id, watched), REMOTE_SPARK_WATCH_MS),
      checking: false,
      stopped: false,
      sent: null,
    };
    watching.set(id, watched);
    void check(id, watched);
  };

  return {
    watch(sparks) {
      const listed = new Map(sparks.map((spark) => [spark.id, spark]));
      for (const [id, watched] of [...watching]) {
        if (listed.get(id)?.hostname !== watched.hostname) end(id, watched);
      }
      for (const spark of listed.values()) {
        const watched = watching.get(spark.id);
        if (watched) {
          watched.cookie = spark.cookie;
          continue;
        }
        try {
          start(spark);
        } catch (error) {
          hooks.guards.log(`Could not watch a remote Spark: ${(error as Error).message}`);
        }
      }
    },
    forget(id) {
      const watched = watching.get(id);
      if (watched) end(id, watched);
    },
    stop() {
      for (const [id, watched] of [...watching]) end(id, watched);
    },
  };
}
