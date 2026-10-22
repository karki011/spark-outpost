import { loginShellEnv, loginShellPath } from '../setup/login-path.ts';
import type { IntakeDeps } from '../advisor/jev-types.ts';
import { createCodeScanner } from '../codescan/scanner.ts';
import { loadConfig, sparkDataDir } from '../config.ts';
import { chatFoldersBase } from '../chat-files/folders.ts';
import { ActiveWork, startLagMonitor } from '../diagnostics/event-loop-lag.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { configuredBackup } from '../persistence/startup-backup.ts';
import { migrateOrExit } from '../persistence/migrate-startup.ts';
import { keepListening, listen } from '../persistence/notifications.ts';
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
import { ParkedTurns } from './parked-turns.ts';
import { startWorker } from './worker.ts';
import { startSparkMcpHost } from '../spark-mcp/host.ts';
import type { SparkToolDeps } from '../spark-mcp/deps.ts';
import { startSparkActionFollowThrough } from '../spark-mcp/actions/follow-through.ts';
import { startPrFollowUp } from '../pr-follow-up/poller.ts';
import { pollNowForApproval } from '../persistence/pr-watches.ts';
import { POLL_CHANNEL } from '../pr-tracking/refresh.ts';
import { connectDesktopBrowser } from '../browser/host-client.ts';
import { agentCalendarHosts } from '../calendar/agent/access.ts';
import { googleClientConfig } from '../calendar/google/config.ts';
import { connectDesktopCalendar } from '../calendar/host-client.ts';
import { parseAppEvent } from '@spark-outpost/contracts';
import { TaskWakes } from '../a2a/task-wakes.ts';
import { stackGit } from '../outposts/stack-git.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.worker });
await migrateOrExit(db, { backup: configuredBackup(config) });

const activeWork = new ActiveWork();
const stopLagMonitor = startLagMonitor({ processName: 'worker', work: activeWork });
const approvalWaiters = new ApprovalWaiters();
const secrets = configuredSecretStore(config);
const jevDeps: IntakeDeps = { db, secrets, fetch, baseUrl: config.TYPESAFE_BASE_URL };
const loginShell = config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null;
const githubApp = gitHubAppConfig(config);
const codeScan = createCodeScanner(db, { scanIndexPace: scanIndexPace({ db }) });
const desktopBrowser = connectDesktopBrowser(process.env, process);
const outpostWakes = new TaskWakes();
const parkedTurns = new ParkedTurns();
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
    loginEnv: loginShellEnv(runCommand, loginShell),
  },
  branchPrefix: config.BRANCH_PREFIX,
  linkScheme: config.SPARK_LINK_SCHEME,
  codeScan,
  browser: desktopBrowser?.host,
  mac: desktopBrowser?.mac,
  calendar: agentCalendarHosts(connectDesktopCalendar(process.env, process), {
    db,
    secrets,
    fetch,
    client: googleClientConfig(config),
  }),
  outposts: { wakes: outpostWakes, parked: parkedTurns, stackGit },
  agentRuntime: config.AGENT_RUNTIME,
  chatFolders: chatFoldersBase(sparkDataDir(config), config.BRANCH_PREFIX),
};
const sparkTools = await startSparkMcpHost(sparkDeps);
desktopBrowser?.blockPorts([sparkTools.port]);
const sparkActions = await startSparkActionFollowThrough(sparkDeps);
const worker = startWorker({
  db,
  browserPane: sparkTools.browser,
  activeWork,
  approvalWaiters,
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
  },
  concurrency: config.WORKER_CONCURRENCY,
  assistantIdleLimits: {
    idleMs: config.ASSISTANT_IDLE_COMPACT_SECONDS * 1000,
    minTokens: config.ASSISTANT_IDLE_COMPACT_TOKENS,
  },
  parked: parkedTurns,
  branchPrefix: config.BRANCH_PREFIX,
  chatFolders: chatFoldersBase(sparkDataDir(config), config.BRANCH_PREFIX),
  shipAccess: {
    secrets,
    runCommand,
    fetch,
    apiUrl: config.GITHUB_API_URL,
    app: githubApp,
    locateGh: () => locateCli('gh', runCommand, loginShell),
    loginPath: loginShellPath(runCommand, loginShell),
    loginEnv: loginShellEnv(runCommand, loginShell),
  },
});
const projectMap = startMapScheduler({
  db,
  scanner: codeScan,
  jev: jevDeps,
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
    loginEnv: loginShellEnv(runCommand, loginShell),
  },
  branchPrefix: config.BRANCH_PREFIX,
  jev: jevDeps,
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
const prPollListener = await listen(config.DATABASE_URL, POLL_CHANNEL, () => prFollowUp.wake());
const outpostListener = await keepListening(
  config.DATABASE_URL,
  'changes',
  (payload) => {
    const event = parseAppEvent(payload);
    if (event) outpostWakes.changed(event);
  },
  { onBack: () => outpostWakes.wakeAll() },
);
console.log(
  `Worker running with concurrency ${config.WORKER_CONCURRENCY} and ${config.AGENT_RUNTIME} agents.`,
);

const shutdown = async () => {
  stopLagMonitor();
  await listener.close();
  await approvalListener.close();
  await prPollListener.close();
  await outpostListener.close();
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
