import { createIntakeRecorder } from '../advisor/intake-recorder.ts';
import { loadConfig } from '../config.ts';
import { Slots } from '../orchestration/slots.ts';
import { createDb } from '../persistence/db.ts';
import { assertMigrated } from '../persistence/migrate.ts';
import { listen } from '../persistence/notifications.ts';
import { keychainSecretStore, memorySecretStore } from '../setup/secrets.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { createProviders } from './providers.ts';
import { startWorker } from './worker.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await assertMigrated(db);

const approvalWaiters = new ApprovalWaiters();
const intake = createIntakeRecorder({
  db,
  secrets:
    config.SECRET_STORE === 'memory'
      ? memorySecretStore(config.MEMORY_SECRETS)
      : keychainSecretStore(),
  fetch,
  baseUrl: config.TYPESAFE_BASE_URL,
});
const worker = startWorker({
  db,
  approvalWaiters,
  intake,
  providers: createProviders(config.AGENT_RUNTIME, config.FAKE_ACP_AGENT),
  leaseSeconds: config.LEASE_SECONDS,
  sessionLimits: {
    idleMs: config.SESSION_IDLE_MINUTES * 60_000,
    openLimit: config.SESSION_OPEN_LIMIT,
  },
  concurrency: config.WORKER_CONCURRENCY,
  agentSlots: new Slots(config.PARALLEL_AGENT_LIMIT),
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
  await intake.settled();
  await db.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
