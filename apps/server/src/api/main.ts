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
import { forgetAllShells } from '../persistence/terminal-shells.ts';
import { attachTerminalSockets } from '../terminal/websocket.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import { probeCapabilities } from '../agents/acp/probe.ts';
import { loginShellLocator } from '../agents/acp/agent-cli.ts';
import { fakeCapabilities } from '../providers/fake.ts';
import { AppEventFeed, listenForAppEvents } from './app-events.ts';
import { createApp } from './app.ts';
import { takeLaunchToken } from './launch-token.ts';
import { gitHubDepsOf } from './ship-routes.ts';
import { gitHubAppConfig } from '../ship/github/app-config.ts';
import { loadInbox } from '../tickets/inbox.ts';
import { RunEventHub } from './run-event-hub.ts';
import { resolveRunTarget } from './run-target.ts';
import { startSlackNotifier } from '../slack/notifier.ts';
import { startSlackSocket } from '../slack/socket.ts';
import { pruneOldRows } from './startup-prune.ts';

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
const terminals = new TerminalSessions(
  loginShellSpawner(),
  defaultLimits,
  shellRegistry(db, workspaceId),
);
const listener = await listen(config.DATABASE_URL, 'run_events', (runId) => hub.notify(runId));

const secrets = configuredSecretStore(config);
const slackDeps = { db, workspaceId, secrets, fetch, slackApiUrl: config.SLACK_API_URL };
const slackNotifier = startSlackNotifier(slackDeps, { linkScheme: config.SPARK_LINK_SCHEME });
const slackSocket = startSlackSocket({
  ...slackDeps,
  runTarget: (conversationId) => resolveRunTarget({ db, workspaceId }, conversationId),
});
const appEvents = new AppEventFeed(undefined, (event) => slackNotifier.changed(event));
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
const app = createApp({
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
  loginShell,
  terminals,
  appEvents,
  activeWork,
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
  outcomeSampleRate: config.OUTCOME_SAMPLE_RATE,
  branchPrefix: config.BRANCH_PREFIX,
  githubApiUrl: config.GITHUB_API_URL,
  githubApp,
  linearApiUrl: config.LINEAR_API_URL,
  slackApiUrl: config.SLACK_API_URL,
  slackNotifier,
  slackSocket,
  serverSpendCapUsd: config.ORCHESTRATION_COST_CAP_USD,
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
const githubDeps = { db, workspaceId, secrets, endpoints, runCommand, loginShell, githubApp };
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
});
attachTerminalSockets(server, terminals, {
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
});

const shutdown = async () => {
  terminals.killAll();
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
