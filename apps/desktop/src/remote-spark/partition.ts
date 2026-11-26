import { session, type Session } from 'electron';
import {
  REMOTE_SPARK_PARTITION_PREFIX,
  remoteSparkOrigin,
  remoteSparkPartition,
} from '@spark-outpost/contracts';
import { withoutSparkToken } from '../browser/request-guard.ts';

export interface RemoteSparkGuards {
  blockedPorts(): ReadonlySet<number>;
  log(line: string): void;
}

export interface RemoteRequest {
  url: string;
  resourceType: string;
}

export interface RemoteRequestFacts {
  hostname: string;
  blockedPorts: ReadonlySet<number>;
}

const NETWORK_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443,
};
const INLINE_SCHEMES = new Set(['data:', 'blob:']);

const cancelsDownloads = new WeakSet<Session>();

export function remoteRequestAllowed(request: RemoteRequest, facts: RemoteRequestFacts): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  const page = request.resourceType === 'mainFrame';
  if (INLINE_SCHEMES.has(url.protocol)) return !page;
  const standardPort = NETWORK_PORTS[url.protocol];
  if (standardPort === undefined) return false;
  const port = url.port === '' ? standardPort : Number(url.port);
  if (facts.blockedPorts.has(port)) return false;
  return !page || url.origin === remoteSparkOrigin(facts.hostname);
}

function ownSession(id: string): Session {
  const partition = remoteSparkPartition(id);
  if (
    !partition.startsWith(REMOTE_SPARK_PARTITION_PREFIX) ||
    partition.length === REMOTE_SPARK_PARTITION_PREFIX.length
  ) {
    throw new Error('A remote Spark window needs its own session name.');
  }
  const target = session.fromPartition(partition);
  if (target === session.defaultSession) {
    throw new Error('A remote Spark window never uses the app session.');
  }
  return target;
}

export async function clearRemoteSparkSession(id: string): Promise<void> {
  await ownSession(id).clearStorageData();
}

export function remoteSparkSession(
  id: string,
  hostname: string,
  guards: RemoteSparkGuards,
): Session {
  const target = ownSession(id);
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);
  target.webRequest.onBeforeRequest((details, callback) => {
    const allowed = remoteRequestAllowed(details, {
      hostname,
      blockedPorts: guards.blockedPorts(),
    });
    if (!allowed) guards.log('Blocked a remote Spark window request.');
    callback({ cancel: !allowed });
  });
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: withoutSparkToken(details.requestHeaders) });
  });
  if (!cancelsDownloads.has(target)) {
    cancelsDownloads.add(target);
    target.on('will-download', (event) => event.preventDefault());
  }
  return target;
}
