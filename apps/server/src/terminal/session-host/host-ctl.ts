import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { openHostConnection, type HostConnection } from './host-connection.ts';
import { nodeLauncher, startHostProcess } from './host-launch.ts';
import { sessionHostPaths, type SessionHostPaths } from './paths.ts';
import { createdSchema, hostRequestSchema } from './protocol.ts';

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
  const request = hostRequestSchema.parse(JSON.parse(await text(process.stdin)));
  if (request.kind !== 'create') throw new Error('The session host helper only starts sessions.');
  const connection = await reachHost(sessionHostPaths(directory));
  try {
    const created = createdSchema.parse(await connection.request(request));
    process.stdout.write(`${JSON.stringify(created)}\n`);
  } finally {
    connection.close();
  }
}
