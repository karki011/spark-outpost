import { loginShellPath } from '../setup/login-path.ts';
import { createIntakeRecorder } from '../advisor/intake-recorder.ts';
import { createCodeScanner } from '../codescan/scanner.ts';
import { loadConfig } from '../config.ts';
import { ActiveWork, startLagMonitor } from '../diagnostics/event-loop-lag.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { configuredBackup } from '../persistence/startup-backup.ts';
import { migrateOrExit } from '../persistence/migrate-startup.ts';
import { listen } from '../persistence/notifications.ts';
import { runCommand } from '../setup/command.ts';
import { configuredSecretStore } from '../setup/secrets.ts';
import { gitHubAppConfig } from '../ship/github/app-config.ts';
import { slackSignInConfig } from '../slack/sign-in-config.ts';
import { locateCli } from '../setup/verify.ts';
import { startMapScheduler } from '../map/scheduler.ts';
import { ApprovalWaiters } from './approval-waiters.ts';
import { createProviders } from './providers.ts';
import { loginShellLocator } from '../agents/acp/agent-cli.ts';
import { scanIndexPace } from '../map/scan-index-pace.ts';
import { flushBufferedText } from './run-appender.ts';
import { startWorker } from './worker.ts';
import { Slots } from '../orchestration/slots.ts';
import { startSparkMcpHost } from '../spark-mcp/host.ts';
import type { SparkToolDeps } from '../spark-mcp/deps.ts';
import { startSparkActionFollowThrough } from '../spark-mcp/actions/follow-through.ts';
import { startPrFollowUp } from '../pr-follow-up/poller.ts';
import { pollNowForApproval } from '../persistence/pr-watches.ts';
import { connectDesktopBrowser } from '../browser/host-client.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.worker });
await migrateOrExit(db, { backup: configuredBackup(config) });

const activeWork = new ActiveWork();
const stopLagMonitor = startLagMonitor({ processName: 'worker', work: activeWork });
const approvalWaiters = new ApprovalWaiters();
const secrets = configuredSecretStore(config);
const intake = createIntakeRecorder({
  db,
  secrets,
  fetch,
  baseUrl: config.TYPESAFE_BASE_URL,
});
const loginShell = config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null;
const githubApp = gitHubAppConfig(config);
const codeScan = createCodeScanner(db, { scanIndexPace: scanIndexPace({ db }) });
const desktopBrowser = connectDesktopBrowser(process.env, process);
const sparkDeps: SparkToolDeps = {
  db,
  secrets,
  fetch,
  linearApiUrl: config.LINEAR_API_URL,
  slackApiUrl: config.SLACK_API_URL,
  slackSignIn: slackSignInConfig(config),
  github: {
    runCommand,
    apiUrl: config.GITHUB_API_URL,
    app: githubApp,
    locateGh: () => locateCli('gh', runCommand, loginShell),
    loginPath: loginShellPath(runCommand, loginShell),
  },
  serverSpendCapUsd: config.ORCHESTRATION_COST_CAP_USD ?? null,
  parallelBuilders: config.COORDINATOR_MODE === 'parallel',
  branchPrefix: config.BRANCH_PREFIX,
  linkScheme: config.SPARK_LINK_SCHEME,
  codeScan,
  browser: desktopBrowser?.host,
};
const sparkTools = await startSparkMcpHost(sparkDeps);
desktopBrowser?.blockPorts([sparkTools.port]);
const sparkActions = await startSparkActionFollowThrough(sparkDeps);
const worker = startWorker({
  db,
  browserPane: sparkTools.browser,
  activeWork,
  approvalWaiters,
  intake,
  providers: createProviders(
    config.AGENT_RUNTIME,
    config.FAKE_ACP_AGENT,
    secrets,
    sparkTools,
    loginShellLocator(loginShell),
  ),
  leaseSeconds: config.LEASE_SECONDS,
  sessionLimits: {
    idleMs: config.SESSION_IDLE_MINUTES * 60_000,
    openLimit: config.SESSION_OPEN_LIMIT,
  },
  concurrency: config.WORKER_CONCURRENCY,
  codeScan,
  branchPrefix: config.BRANCH_PREFIX,
  coordinator: config.COORDINATOR_MODE,
  forcedPlacement: config.COORDINATOR_PLACEMENT,
  agentSlots: new Slots(config.PARALLEL_AGENT_LIMIT),
  shipAccess: {
    secrets,
    runCommand,
    fetch,
    apiUrl: config.GITHUB_API_URL,
    app: githubApp,
    locateGh: () => locateCli('gh', runCommand, loginShell),
    loginPath: loginShellPath(runCommand, loginShell),
  },
  ...(config.ORCHESTRATION_COST_CAP_USD
    ? { budget: { costCapUsd: config.ORCHESTRATION_COST_CAP_USD } }
    : {}),
});
const projectMap = startMapScheduler({
  db,
  scanner: codeScan,
  jev: intake.deps,
  rootPrefix: config.MAP_ROOT_PREFIX ?? null,
});
const prFollowUp = startPrFollowUp({
  db,
  github: {
    secrets,
    runCommand,
    fetch,
    apiUrl: config.GITHUB_API_URL,
    app: githubApp,
    locateGh: () => locateCli('gh', runCommand, loginShell),
    loginPath: loginShellPath(runCommand, loginShell),
  },
  branchPrefix: config.BRANCH_PREFIX,
  jev: intake.deps,
});
const listener = await listen(config.DATABASE_URL, 'jobs', () => worker.wake());
const approvalListener = await listen(config.DATABASE_URL, 'approvals', (id) => {
  approvalWaiters.notify(id);
  sparkActions.wake();
  void pollNowForApproval(db, id)
    .then((found) => {
      if (found) prFollowUp.wake();
    })
    .catch(() => undefined);
});
console.log(
  `Worker running with concurrency ${config.WORKER_CONCURRENCY} and ${config.AGENT_RUNTIME} agents.`,
);

const shutdown = async () => {
  stopLagMonitor();
  await listener.close();
  await approvalListener.close();
  await projectMap.stop();
  await prFollowUp.stop();
  await worker.stop();
  await flushBufferedText();
  await sparkActions.stop();
  await sparkTools.close();
  await db.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
