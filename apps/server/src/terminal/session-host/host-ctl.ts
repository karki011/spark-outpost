import { setTimeout as delay } from 'node:timers/promises';
import { openHostConnection, type HostConnection } from './host-connection.ts';
import { nodeLauncher, startHostProcess } from './host-launch.ts';
import { sessionHostPaths, type SessionHostPaths } from './paths.ts';

const START_WAIT_MS = 15_000;
const RETRY_MS = 50;

async function reachHost(paths: SessionHostPaths): Promise<HostConnection> {
  const first = await openHostConnection(paths);
  if (first) return first;
  startHostProcess(nodeLauncher(), paths.directory);
  const until = Date.now() + START_WAIT_MS;
  while (Date.now() < until) {
    await delay(RETRY_MS);
    const connection = await openHostConnection(paths);
    if (connection) return connection;
  }
  throw new Error('The session host did not start.');
}

export async function runCtl(directory: string): Promise<void> {
  const connection = await reachHost(sessionHostPaths(directory));
  connection.close();
}
