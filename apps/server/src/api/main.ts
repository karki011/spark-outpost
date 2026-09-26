import { loadConfig } from '../config.ts';
import { ensureLocalWorkspace, pruneEmptyConversations } from '../persistence/conversations.ts';
import { pruneUnlinkedAttachments } from '../persistence/attachments.ts';
import { pruneProtocolLog } from '../persistence/audit-log.ts';
import { createDb } from '../persistence/db.ts';
import { assertMigrated } from '../persistence/migrate.ts';
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
import { createApp } from './app.ts';
import { RunEventHub } from './run-event-hub.ts';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await assertMigrated(db);

const workspaceId = await ensureLocalWorkspace(db);
await pruneEmptyConversations(db, workspaceId);
await pruneUnlinkedAttachments(db, workspaceId);
await pruneProtocolLog(db, config.AUDIT_RETENTION_DAYS);
const hub = new RunEventHub();
ensureSpawnHelperExecutable();
const terminals = new TerminalSessions(loginShellSpawner());
const listener = await listen(config.DATABASE_URL, 'run_events', (runId) => hub.notify(runId));

const app = createApp({
  db,
  hub,
  workspaceId,
  secrets: config.SECRET_STORE === 'memory' ? memorySecretStore() : keychainSecretStore(),
  endpoints: {
    anthropicBaseUrl: config.ANTHROPIC_BASE_URL,
    openaiBaseUrl: config.OPENAI_BASE_URL,
    typesafeBaseUrl: config.TYPESAFE_BASE_URL,
    fetch,
  },
  runCommand,
  probeCapabilities: async (provider) => ({
    provider,
    ...(config.AGENT_RUNTIME === 'fake'
      ? fakeCapabilities()
      : await probeCapabilities(agentDefinitions[provider])),
  }),
  loginShell: config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null,
  terminals,
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
});

const server = app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
});
attachTerminalSockets(server, terminals, {
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
});

const shutdown = async () => {
  terminals.killAll();
  server.close();
  server.closeAllConnections();
  await listener.close();
  await db.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
