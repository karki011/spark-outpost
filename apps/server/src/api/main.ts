import { resolve } from 'node:path';
import { DEV_API_TOKEN_FILE } from '@spark-outpost/contracts';
import { loadConfig } from '../config.ts';
import { startMorningBrief } from '../digest/morning.ts';
import { ensureLocalWorkspace, pruneEmptyConversations } from '../persistence/conversations.ts';
import { pruneUnlinkedAttachments } from '../persistence/attachments.ts';
import { pruneProtocolLog } from '../persistence/audit-log.ts';
import { seedModelStats } from '../model-cards/ingest.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { startOutcomeSweep } from '../outcomes/sweep.ts';
import { configuredBackup } from '../persistence/startup-backup.ts';
import { migrateOrExit } from '../persistence/migrate-startup.ts';
import { listen } from '../persistence/notifications.ts';
import { runCommand } from '../setup/command.ts';
import { keychainSecretStore, memorySecretStore } from '../setup/secrets.ts';
import { loginShellSpawner } from '../terminal/pty.ts';
import { ensureSpawnHelperExecutable } from '../terminal/pty-helper.ts';
import { TerminalSessions } from '../terminal/sessions.ts';
import { attachTerminalSockets } from '../terminal/websocket.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import { probeCapabilities } from '../agents/acp/probe.ts';
import { fakeCapabilities } from '../providers/fake.ts';
import { AppEventFeed, listenForAppEvents } from './app-events.ts';
import { createApp } from './app.ts';
import { scanHomesAt } from '../mcp/scan.ts';
import { takeLaunchToken } from './launch-token.ts';
import { gitHubDepsOf } from './ship-routes.ts';
import { loadInbox } from '../tickets/inbox.ts';
import { RunEventHub } from './run-event-hub.ts';

const apiToken = takeLaunchToken(
  process.env,
  resolve(import.meta.dirname, '../../../..', DEV_API_TOKEN_FILE),
);
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.api });
await migrateOrExit(db, { backup: configuredBackup(config) });

const workspaceId = await ensureLocalWorkspace(db);
await pruneEmptyConversations(db, workspaceId);
await pruneUnlinkedAttachments(db, workspaceId);
await pruneProtocolLog(db, config.AUDIT_RETENTION_DAYS);
await seedModelStats(db);
const hub = new RunEventHub();
ensureSpawnHelperExecutable();
const terminals = new TerminalSessions(loginShellSpawner());
const listener = await listen(config.DATABASE_URL, 'run_events', (runId) => hub.notify(runId));
const appEvents = new AppEventFeed();
const appEventListener = await listenForAppEvents(config.DATABASE_URL, appEvents);

const secrets =
  config.SECRET_STORE === 'memory'
    ? memorySecretStore()
    : keychainSecretStore(config.KEYCHAIN_SERVICE);
const endpoints = {
  anthropicBaseUrl: config.ANTHROPIC_BASE_URL,
  openaiBaseUrl: config.OPENAI_BASE_URL,
  typesafeBaseUrl: config.TYPESAFE_BASE_URL,
  zaiBaseUrl: config.ZAI_BASE_URL,
  fetch,
};
const loginShell = config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null;
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
      : await probeCapabilities(agentDefinitions[provider], { secrets })),
  }),
  loginShell,
  terminals,
  appEvents,
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
  outcomeSampleRate: config.OUTCOME_SAMPLE_RATE,
  branchPrefix: config.BRANCH_PREFIX,
  githubApiUrl: config.GITHUB_API_URL,
  linearApiUrl: config.LINEAR_API_URL,
  ...(config.WEB_ROOT ? { webRoot: config.WEB_ROOT } : {}),
  ...(config.MCP_SCAN_HOME ? { mcpHomes: scanHomesAt(config.MCP_SCAN_HOME) } : {}),
});
const outcomeSweep = startOutcomeSweep(db, workspaceId, {
  sampleRate: config.OUTCOME_SAMPLE_RATE,
});
const githubDeps = { db, workspaceId, secrets, endpoints, runCommand, loginShell };
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
});
attachTerminalSockets(server, terminals, {
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
});

const shutdown = async () => {
  terminals.killAll();
  outcomeSweep.stop();
  morningBrief?.stop();
  server.close();
  server.closeAllConnections();
  await listener.close();
  await appEventListener.close();
  await db.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
