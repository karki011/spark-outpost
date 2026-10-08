import { resolve } from 'node:path';
import { DEV_API_TOKEN_FILE } from '@spark-outpost/contracts';
import { loadConfig } from '../config.ts';
import { startMorningBrief } from '../digest/morning.ts';
import { ensureLocalWorkspace } from '../persistence/conversations.ts';
import { seedModelStats } from '../model-cards/ingest.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { ActiveWork, startLagMonitor } from '../diagnostics/event-loop-lag.ts';
import { startOutcomeSweep } from '../outcomes/sweep.ts';
import { configuredBackup } from '../persistence/startup-backup.ts';
import { migrateOrExit } from '../persistence/migrate-startup.ts';
import { listen } from '../persistence/notifications.ts';
import { runCommand } from '../setup/command.ts';
import { configuredSecretStore } from '../setup/secrets.ts';
import { loginShellSpawner } from '../terminal/pty.ts';
import { ensureSpawnHelperExecutable } from '../terminal/pty-helper.ts';
import { defaultLimits, TerminalSessions } from '../terminal/sessions.ts';
import { shellRegistry } from '../terminal/shell-registry.ts';
import { shellWatchers } from '../terminal/shell-watchers.ts';
import { pullRequestScan } from '../terminal/pull-request-scan.ts';
import { terminalPullTracker } from '../pr-tracking/terminal.ts';
import { forgetAllShells } from '../persistence/terminal-shells.ts';
import { stopAllPreviewRows } from '../persistence/preview-servers.ts';
import { previewRuntime } from '../preview/process.ts';
import { PreviewServers } from '../preview/servers.ts';
import { attachTerminalSockets } from '../terminal/websocket.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import { probeCapabilities } from '../agents/acp/probe.ts';
import { loginShellLocator } from '../agents/acp/agent-cli.ts';
import { fakeCapabilities } from '../providers/fake.ts';
import { AppEventFeed, listenForAppEvents } from './app-events.ts';
import { createAppParts } from './app.ts';
import { takeLaunchToken } from './launch-token.ts';
import { gitHubDepsOf } from './ship-routes.ts';
import { gitHubAppConfig } from '../ship/github/app-config.ts';
import { loadInbox } from '../tickets/inbox.ts';
import { RunEventHub } from './run-event-hub.ts';
import { resolveRunTarget } from './run-target.ts';
import { startSlackNotifier } from '../slack/notifier.ts';
import { slackSignInConfig } from '../slack/sign-in-config.ts';
import { startSlackSocket } from '../slack/socket.ts';
import { pruneOldRows } from './startup-prune.ts';
import { cloneJobsFor } from './project-clone-routes.ts';
import { connectDesktopBrowser } from '../browser/host-client.ts';
import { createCodeScanner } from '../codescan/scanner.ts';
import { scanIndexPace } from '../map/scan-index-pace.ts';
import { loginShellEnv, loginShellPath } from '../setup/login-path.ts';
import { locateCli } from '../setup/verify.ts';
import { startSparkMcpHost } from '../spark-mcp/host.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { createNativeRuntime } from '../terminal/native-runtime.ts';

const apiToken = takeLaunchToken(
  process.env,
  resolve(import.meta.dirname, '../../../..', DEV_API_TOKEN_FILE),
);
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.api });
await migrateOrExit(db, { backup: configuredBackup(config) });

const workspaceId = await ensureLocalWorkspace(db);
await seedModelStats(db);
const hub = new RunEventHub();
const activeWork = new ActiveWork();
const stopLagMonitor = startLagMonitor({ processName: 'API', work: activeWork });
ensureSpawnHelperExecutable();
await forgetAllShells(db, workspaceId);
await stopAllPreviewRows(db, workspaceId);
const previews = new PreviewServers(db, workspaceId, previewRuntime());
const listener = await listen(config.DATABASE_URL, 'run_events', (runId) => hub.notify(runId));

const secrets = configuredSecretStore(config);
const slackSignIn = slackSignInConfig(config);
const slackDeps = {
  db,
  workspaceId,
  secrets,
  fetch,
  slackApiUrl: config.SLACK_API_URL,
  signIn: slackSignIn,
};
const slackNotifier = startSlackNotifier(slackDeps, { linkScheme: config.SPARK_LINK_SCHEME });
const slackSocket = startSlackSocket({
  ...slackDeps,
  runTarget: (conversationId) => resolveRunTarget({ db, workspaceId }, conversationId),
});
const appEvents = new AppEventFeed(undefined, (event) => {
  slackNotifier.changed(event);
  if (event.kind === 'preview') void previews.sync();
});
const appEventListener = await listenForAppEvents(config.DATABASE_URL, appEvents);
const endpoints = {
  anthropicBaseUrl: config.ANTHROPIC_BASE_URL,
  openaiBaseUrl: config.OPENAI_BASE_URL,
  typesafeBaseUrl: config.TYPESAFE_BASE_URL,
  zaiBaseUrl: config.ZAI_BASE_URL,
  fetch,
};
const loginShell = config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null;
const githubApp = gitHubAppConfig(config);
const cloneDeps = {
  db,
  workspaceId,
  secrets,
  endpoints,
  runCommand,
  loginShell,
  githubApiUrl: config.GITHUB_API_URL,
  githubApp,
  cloneTest:
    config.AGENT_RUNTIME === 'fake' && config.CLONE_TEST_ROOT
      ? { root: config.CLONE_TEST_ROOT }
      : null,
  reservedFolders: [config.SPARK_DATA_DIR, config.SPARK_LOG_DIR, config.BACKUP_DIR],
};
const githubDeps = { db, workspaceId, secrets, endpoints, runCommand, loginShell, githubApp };
const terminals = new TerminalSessions(
  loginShellSpawner(),
  defaultLimits,
  shellWatchers(
    shellRegistry(db, workspaceId),
    pullRequestScan(
      terminalPullTracker(gitHubDepsOf({ ...githubDeps, githubApiUrl: config.GITHUB_API_URL })),
    ),
  ),
);
const desktopBrowser = connectDesktopBrowser(process.env, process);
const nativeMcp = await startSparkMcpHost({
  db,
  secrets,
  fetch,
  linearApiUrl: config.LINEAR_API_URL,
  slackApiUrl: config.SLACK_API_URL,
  slackSignIn,
  github: {
    runCommand,
    apiUrl: config.GITHUB_API_URL,
    app: githubApp,
    locateGh: () => locateCli('gh', runCommand, loginShell),
    loginPath: loginShellPath(runCommand, loginShell),
    loginEnv: loginShellEnv(runCommand, loginShell),
  },
  parallelBuilders: config.COORDINATOR_MODE === 'parallel',
  branchPrefix: config.BRANCH_PREFIX,
  linkScheme: config.SPARK_LINK_SCHEME,
  codeScan: createCodeScanner(db, { scanIndexPace: scanIndexPace({ db }) }),
  browser: desktopBrowser?.host,
});
const nativeApprovalWaiters = new ApprovalWaiters();
const nativeApprovalListener = await listen(config.DATABASE_URL, 'approvals', (id) =>
  nativeApprovalWaiters.notify(id),
);
const nativeTerminals = await createNativeRuntime({
  db,
  workspaceId,
  terminals,
  dataDir: config.SPARK_DATA_DIR ?? resolve(import.meta.dirname, '../../../..', '.local'),
  channel: config.BRANCH_PREFIX,
  mcp: nativeMcp,
  locateCli: loginShellLocator(loginShell),
  branchPrefix: config.BRANCH_PREFIX,
  approvalWaiters: nativeApprovalWaiters,
});
await nativeTerminals.recover();
desktopBrowser?.blockPorts([nativeMcp.port, nativeTerminals.port]);
const clones = cloneJobsFor(cloneDeps);
await clones.recover();
const { app, reconcileRemote } = createAppParts({
  clones,
  cloneTest: cloneDeps.cloneTest,
  db,
  hub,
  workspaceId,
  secrets,
  endpoints,
  runCommand,
  probeCapabilities: async (provider) => ({
    provider,
    ...(config.AGENT_RUNTIME === 'fake'
      ? fakeCapabilities(provider)
      : await probeCapabilities(agentDefinitions[provider], {
          secrets,
          locateCli: loginShellLocator(loginShell),
        })),
  }),
  agentRuntime: config.AGENT_RUNTIME,
  loginShell,
  terminals,
  nativeTerminals,
  previews,
  appEvents,
  activeWork,
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
  outcomeSampleRate: config.OUTCOME_SAMPLE_RATE,
  branchPrefix: config.BRANCH_PREFIX,
  linkScheme: config.SPARK_LINK_SCHEME,
  githubApiUrl: config.GITHUB_API_URL,
  githubApp,
  linearApiUrl: config.LINEAR_API_URL,
  slackApiUrl: config.SLACK_API_URL,
  slackSignIn,
  slackNotifier,
  slackSocket,
  parallelBuilders: config.COORDINATOR_MODE === 'parallel',
  ...(config.WEB_ROOT ? { webRoot: config.WEB_ROOT } : {}),
  diagnostics: {
    appVersion: config.SPARK_APP_VERSION ?? null,
    logDir: config.SPARK_LOG_DIR ?? null,
    dataDir: config.SPARK_DATA_DIR ?? null,
  },
});
const outcomeSweep = startOutcomeSweep(db, workspaceId, {
  sampleRate: config.OUTCOME_SAMPLE_RATE,
});
const morningBrief = config.MORNING_BRIEF
  ? startMorningBrief(db, workspaceId, () =>
      loadInbox({
        db,
        workspaceId,
        secrets,
        fetch,
        linearApiUrl: config.LINEAR_API_URL,
        github: gitHubDepsOf({ ...githubDeps, githubApiUrl: config.GITHUB_API_URL }),
      }),
    )
  : null;

const server = app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
  void pruneOldRows({ db, workspaceId, auditRetentionDays: config.AUDIT_RETENTION_DAYS });
  void slackSocket.refresh();
  reconcileRemote().catch((error: unknown) => {
    console.error('Could not check Tailscale Serve', (error as Error).message);
  });
});
attachTerminalSockets(server, terminals, {
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
});

const shutdown = async () => {
  clones.stopAll();
  await nativeTerminals.dispose();
  terminals.killAll();
  await nativeMcp.close();
  await nativeApprovalListener.close();
  await previews.stopAll('shutdown').catch(() => undefined);
  stopLagMonitor();
  outcomeSweep.stop();
  morningBrief?.stop();
  slackSocket.stop();
  await slackNotifier.stop();
  server.close();
  server.closeAllConnections();
  await listener.close();
  await appEventListener.close();
  await db.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
