import { createIntakeRecorder } from '../advisor/intake-recorder.ts';
import { createCodeScanner } from '../codescan/scanner.ts';
import { loadConfig } from '../config.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { assertMigrated } from '../persistence/migrate.ts';
import { listen } from '../persistence/notifications.ts';
import { keychainSecretStore, memorySecretStore } from '../setup/secrets.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { createProviders } from './providers.ts';
import { startWorker } from './worker.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.worker });
await assertMigrated(db);

const approvalWaiters = new ApprovalWaiters();
const secrets =
  config.SECRET_STORE === 'memory'
    ? memorySecretStore(config.MEMORY_SECRETS)
    : keychainSecretStore();
const intake = createIntakeRecorder({
  db,
  secrets,
  fetch,
  baseUrl: config.TYPESAFE_BASE_URL,
});
const worker = startWorker({
  db,
  approvalWaiters,
  intake,
  providers: createProviders(config.AGENT_RUNTIME, config.FAKE_ACP_AGENT, secrets),
  leaseSeconds: config.LEASE_SECONDS,
  sessionLimits: {
    idleMs: config.SESSION_IDLE_MINUTES * 60_000,
    openLimit: config.SESSION_OPEN_LIMIT,
  },
  concurrency: config.WORKER_CONCURRENCY,
  codeScan: createCodeScanner(db),
  ...(config.ORCHESTRATION_COST_CAP_USD
    ? { budget: { costCapUsd: config.ORCHESTRATION_COST_CAP_USD } }
    : {}),
});
const listener = await listen(config.DATABASE_URL, 'jobs', () => worker.wake());
const approvalListener = await listen(config.DATABASE_URL, 'approvals', (id) =>
  approvalWaiters.notify(id),
);
console.log(
  `Worker running with concurrency ${config.WORKER_CONCURRENCY} and ${config.AGENT_RUNTIME} agents.`,
);

const shutdown = async () => {
  await listener.close();
  await approvalListener.close();
  await worker.stop();
  await db.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
