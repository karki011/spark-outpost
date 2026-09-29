import { createIntakeRecorder } from '../advisor/intake-recorder.ts';
import { createCodeScanner } from '../codescan/scanner.ts';
import { loadConfig } from '../config.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { configuredBackup } from '../persistence/startup-backup.ts';
import { migrateOrExit } from '../persistence/migrate-startup.ts';
import { listen } from '../persistence/notifications.ts';
import { runCommand } from '../setup/command.ts';
import { configuredSecretStore } from '../setup/secrets.ts';
import { locateCli } from '../setup/verify.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { createProviders } from './providers.ts';
import { startWorker } from './worker.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.worker });
await migrateOrExit(db, { backup: configuredBackup(config) });

const approvalWaiters = new ApprovalWaiters();
const secrets = configuredSecretStore(config);
const intake = createIntakeRecorder({
  db,
  secrets,
  fetch,
  baseUrl: config.TYPESAFE_BASE_URL,
});
const loginShell = config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null;
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
  branchPrefix: config.BRANCH_PREFIX,
  shipAccess: {
    secrets,
    runCommand,
    fetch,
    apiUrl: config.GITHUB_API_URL,
    locateGh: () => locateCli('gh', runCommand, loginShell),
  },
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
