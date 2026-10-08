import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertScratchDir } from '../repo.ts';
import { ROOT, startStack, stopStack } from '../stack.ts';

const dir = await assertScratchDir(process.argv[2] ?? '');
const stack = await startStack('acp', 'current', ROOT, dir, true, {
  env: { SPARK_DATA_DIR: join(dir, 'data'), SPARK_LOG_DIR: join(dir, 'logs', 'spark') },
});
await writeFile(
  join(dir, 'stack.json'),
  JSON.stringify({
    api: stack.urls.api,
    web: stack.urls.web,
    token: stack.apiToken,
    databaseUrl: stack.databaseUrl,
    cleanup: stack.cleanupSql,
    workspaceId: stack.workspaceId,
    workerPid: stack.workerPid,
    pid: process.pid,
  }),
  { mode: 0o600 },
);
console.log(`Stack up: ${stack.urls.web}`);
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await stopStack(stack, process.env.FINAL_DROP !== '1');
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
setInterval(() => undefined, 60_000);
