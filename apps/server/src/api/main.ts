import { join, resolve } from 'node:path';
import { DEV_API_TOKEN_FILE, artifactPortFor, isKeepTerminalsStop } from '@spark-outpost/contracts';
import { LOCAL_DATA_DIR, loadConfig, sparkDataDir } from '../config.ts';
import { chatFoldersBase } from '../chat-files/folders.ts';
import { chatResearchBase } from '../chat-files/research-copies.ts';
import { startArtifactOrigin } from '../artifacts/origin-server.ts';
import { startMorningBrief } from '../digest/morning.ts';
import { startWeekRecap } from '../recap/schedule.ts';
import { followAssistantChat } from '../companion/assistant.ts';
import { ensureLocalWorkspace } from '../persistence/conversations.ts';
import { seedRelay } from '../persistence/relay.ts';
import { acceptRulesBaseline } from '../spark-rules/rules-store.ts';
import { seedModelStats } from '../model-cards/ingest.ts';
import { createDb, POOL_MAX } from '../persistence/db.ts';
import { ActiveWork, startLagMonitor } from '../diagnostics/event-loop-lag.ts';
import { startOutcomeSweep } from '../outcomes/sweep.ts';
import { startArchiveSweep } from '../workflow/archive-inactive.ts';
import { configuredBackup } from '../persistence/startup-backup.ts';
import { migrateOrExit } from '../persistence/migrate-startup.ts';
import { listen } from '../persistence/notifications.ts';
import { runCommand } from '../setup/command.ts';
import { configuredSecretStore } from '../setup/secrets.ts';
import { processKillsSent } from '../terminal/process-group.ts';
import { loginShellSpawner } from '../terminal/pty.ts';
import { savedPort, savePort } from '../terminal/tmux/stable-port.ts';
import { chooseTmux, killTmuxServer, tmuxChoiceLine } from '../terminal/tmux/tmux-host.ts';
import { tmuxSpawner } from '../terminal/tmux/tmux-spawner.ts';
import { ensureSpawnHelperExecutable } from '../terminal/pty-helper.ts';
import { defaultLimits, TerminalSessions } from '../terminal/sessions.ts';
import { shellRegistry } from '../terminal/shell-registry.ts';
import { shellWatchers } from '../terminal/shell-watchers.ts';
import { pullRequestScan } from '../terminal/pull-request-scan.ts';
import { shellAlerts } from '../terminal/shell-alerts.ts';
import { recordShellAlert } from '../persistence/shell-alerts.ts';
import { notifyAttention } from '../persistence/attention-items.ts';
import { terminalPullTracker } from '../pr-tracking/terminal.ts';
import { forgetAllShells } from '../persistence/terminal-shells.ts';
import { stopAllPreviewRows } from '../persistence/preview-servers.ts';
import { previewRuntime } from '../preview/process.ts';
import { PreviewServers } from '../preview/servers.ts';
import { attachTerminalSockets } from '../terminal/websocket.ts';
import { agentTerminalRuntime } from '../terminal/agent-terminal-process.ts';
import { AgentTerminals } from '../terminal/agent-terminals.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import { probeCapabilities } from '../agents/acp/probe.ts';
import { loginShellLocator } from '../agents/acp/agent-cli.ts';
import { fakeCapabilities } from '../providers/fake.ts';
import { AppEventFeed, listenForAppEvents } from './app-events.ts';
import { createAppParts } from './app.ts';
import { takeLaunchToken } from './launch-token.ts';
import { gitHubDepsOf, shipDepsOf } from './ship-routes.ts';
import { gitHubAppConfig } from '../ship/github/app-config.ts';
import { loadInbox } from '../tickets/inbox.ts';
import { pullRequestChanged } from '../tickets/inbox-snapshot.ts';
import { RunEventHub } from './run-event-hub.ts';
import { systemPortProbe } from '../terminal/chat-port-probe.ts';
import { chatPortWatcher, type ChatPortWatcher } from '../terminal/chat-port-watcher.ts';
import { postgresPort } from '../terminal/chat-ports.ts';
import { resolveRunTarget } from './run-target.ts';
import { FOCUS_TTL_MS, startSlackNotifier } from '../slack/notifier.ts';
import { ClientFocus } from '../slack/client-focus.ts';
import { pushKeys } from '../remote/push-keys.ts';
import { startPushNotifier } from '../remote/push-notifier.ts';
import { connectDesktopCalendar } from '../calendar/host-client.ts';
import { startCalendarTicker, type CalendarTicker } from '../calendar/ticker.ts';
import { fakeMeetingSource } from '../meetings/fake-source.ts';
import { createMeetingService } from '../meetings/service.ts';
import { googleClientConfig } from '../calendar/google/config.ts';
import { createGoogleSource } from '../calendar/google/source.ts';
import { CALENDAR_WRITTEN_CHANNEL, agentCalendarHosts } from '../calendar/agent/access.ts';
import { generateVapidKeys, webPushSend } from '../remote/push-send.ts';
import { slackSignInConfig } from '../slack/sign-in-config.ts';
import { startSlackSocket } from '../slack/socket.ts';
import { armShutdownWatchdog, runShutdownSteps } from './shutdown-steps.ts';
import { schedulePrune, type PruneSchedule } from './startup-prune.ts';
import { cloneJobsFor } from './project-clone-routes.ts';
import { connectDesktopBrowser } from '../browser/host-client.ts';
import { createCodeScanner } from '../codescan/scanner.ts';
import { scanIndexPace } from '../map/scan-index-pace.ts';
import { loginShellEnv, loginShellPath } from '../setup/login-path.ts';
import { locateCli } from '../setup/verify.ts';
import { startSparkMcpHost } from '../spark-mcp/host.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { createNativeRuntime } from '../terminal/native-runtime.ts';
import { outpostDelivery } from '../outposts/mount.ts';
import { stackGit } from '../outposts/stack-git.ts';

const apiToken = takeLaunchToken(
  process.env,
  resolve(import.meta.dirname, '../../../..', DEV_API_TOKEN_FILE),
);
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: POOL_MAX.api });
await migrateOrExit(db, { backup: configuredBackup(config) });

const workspaceId = await ensureLocalWorkspace(db);
await seedModelStats(db);
await seedRelay(db, workspaceId).catch((error: unknown) => {
  console.error('Could not add Relay', error);
});
await acceptRulesBaseline().catch((error: unknown) => {
  console.error("Could not record Spark's accepted rules", error);
});
const hub = new RunEventHub();
const activeWork = new ActiveWork();
const stopLagMonitor = startLagMonitor({ processName: 'API', work: activeWork });
ensureSpawnHelperExecutable();
await forgetAllShells(db, workspaceId);
await followAssistantChat(db, workspaceId).catch((error: unknown) => {
  console.error('Could not apply the Ask Spark settings', (error as Error).message);
});
await stopAllPreviewRows(db, workspaceId);
const previews = new PreviewServers(db, workspaceId, previewRuntime());
const agentTerminals = new AgentTerminals(db, workspaceId, agentTerminalRuntime());
await agentTerminals.recover();
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
const focus = new ClientFocus(Date.now, FOCUS_TTL_MS);
const slackNotifier = startSlackNotifier(slackDeps, {
  linkScheme: config.SPARK_LINK_SCHEME,
  focus,
});
const remotePushKeys = pushKeys(secrets, generateVapidKeys);
const desktopCalendar = connectDesktopCalendar(process.env, process);
const googleCalendar = desktopCalendar
  ? createGoogleSource({ db, workspaceId, secrets, fetch, client: googleClientConfig(config) })
  : null;
await googleCalendar?.start();
let calendarTicker: CalendarTicker | null = null;
let chatPorts: ChatPortWatcher | null = null;
const pushNotifier = startPushNotifier({
  db,
  workspaceId,
  keys: remotePushKeys,
  focus,
  send: webPushSend,
  held: () => calendarTicker?.held() ?? false,
});
calendarTicker = desktopCalendar
  ? startCalendarTicker({
      db,
      workspaceId,
      host: desktopCalendar,
      google: googleCalendar,
      push: pushNotifier,
    })
  : null;
const slackSocket = startSlackSocket({
  ...slackDeps,
  runTarget: (conversationId) => resolveRunTarget({ db, workspaceId }, conversationId),
});
const endpoints = {
  anthropicBaseUrl: config.ANTHROPIC_BASE_URL,
  openaiBaseUrl: config.OPENAI_BASE_URL,
  typesafeBaseUrl: config.TYPESAFE_BASE_URL,
  zaiBaseUrl: config.ZAI_BASE_URL,
  fetch,
};
const loginShell = config.CLI_LOOKUP_LOGIN_SHELL ? process.env.SHELL || '/bin/zsh' : null;
const githubApp = gitHubAppConfig(config);
const githubDeps = { db, workspaceId, secrets, endpoints, runCommand, loginShell, githubApp };
const outposts = outpostDelivery({
  db,
  port: config.API_PORT,
  apiToken,
  ship: shipDepsOf({
    ...githubDeps,
    githubApiUrl: config.GITHUB_API_URL,
    branchPrefix: config.BRANCH_PREFIX,
  }),
});
const appEvents = new AppEventFeed(undefined, (event) => {
  slackNotifier.changed(event);
  pushNotifier.changed(event);
  outposts.changed(event);
  if (event.kind === 'pull_request') pullRequestChanged(db, workspaceId);
  if (event.kind === 'preview') void previews.sync();
  if (event.kind === 'agent_terminal') {
    void agentTerminals.sync();
    chatPorts?.wake();
  }
});
const appEventListener = await listenForAppEvents(config.DATABASE_URL, appEvents);
const meetings = createMeetingService({
  db,
  workspaceId,
  source: fakeMeetingSource(process.env),
  publish: (event) => appEvents.publish(event),
});
await meetings.recover();
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
const localDir = LOCAL_DATA_DIR;
const nativeDataDir = sparkDataDir(config);
const chatFolders = chatFoldersBase(nativeDataDir, config.BRANCH_PREFIX);
const researchCopies = chatResearchBase(nativeDataDir, config.BRANCH_PREFIX);
const nativeSessionsDir = join(nativeDataDir, config.BRANCH_PREFIX, 'terminal-sessions');
const perInstance = config.SPARK_DATA_DIR ? '' : `-${config.API_PORT}`;
const terminalTmux = chooseTmux(
  process.env,
  join(nativeDataDir, config.BRANCH_PREFIX, `tmux${perInstance}`),
  config.SPARK_DATA_DIR ? null : localDir,
);
if (terminalTmux.host) console.log(tmuxChoiceLine(terminalTmux));
else console.warn(tmuxChoiceLine(terminalTmux));
const sparkPorts = new Set([config.API_PORT, artifactPortFor(config.API_PORT)]);
const databasePort = postgresPort(config.DATABASE_URL);
if (databasePort) sparkPorts.add(databasePort);
chatPorts = chatPortWatcher({
  probe: systemPortProbe(terminalTmux.host),
  agentRoots: () => agentTerminals.roots(),
  excluded: sparkPorts,
  changed: () =>
    appEvents.publish(JSON.stringify({ kind: 'chat_ports', conversationId: null, runId: null })),
});
const terminals = new TerminalSessions(
  tmuxSpawner(loginShellSpawner(), terminalTmux.host),
  defaultLimits,
  shellWatchers(
    shellRegistry(db, workspaceId),
    pullRequestScan(
      terminalPullTracker(gitHubDepsOf({ ...githubDeps, githubApiUrl: config.GITHUB_API_URL })),
    ),
    shellAlerts((alert) => {
      void recordShellAlert(db, workspaceId, alert)
        .then((saved) => (saved ? notifyAttention(db, alert.conversationId) : undefined))
        .catch((error: unknown) => console.error('Could not save a shell tab alert', error));
    }),
    chatPorts,
  ),
);
const desktopBrowser = connectDesktopBrowser(process.env, process);
const nativeMcpPortFile = join(nativeSessionsDir, `mcp-port${perInstance}`);
const nativeMcp = await startSparkMcpHost(
  {
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
    branchPrefix: config.BRANCH_PREFIX,
    linkScheme: config.SPARK_LINK_SCHEME,
    codeScan: createCodeScanner(db, { scanIndexPace: scanIndexPace({ db }) }),
    browser: desktopBrowser?.host,
    mac: desktopBrowser?.mac,
    chatFolders,
    calendar: agentCalendarHosts(desktopCalendar, {
      db,
      secrets,
      fetch,
      client: googleClientConfig(config),
    }),
  },
  undefined,
  savedPort(nativeMcpPortFile),
);
savePort(nativeMcpPortFile, nativeMcp.port);
const nativeApprovalWaiters = new ApprovalWaiters();
const calendarWrittenListener = await listen(config.DATABASE_URL, CALENDAR_WRITTEN_CHANNEL, () =>
  googleCalendar?.refresh(),
);
const nativeApprovalListener = await listen(config.DATABASE_URL, 'approvals', (id) =>
  nativeApprovalWaiters.notify(id),
);
const nativeTerminals = await createNativeRuntime({
  db,
  workspaceId,
  terminals,
  dataDir: nativeDataDir,
  channel: config.BRANCH_PREFIX,
  mcp: nativeMcp,
  tmux: terminalTmux.host,
  locateCli: loginShellLocator(loginShell),
  branchPrefix: config.BRANCH_PREFIX,
  approvalWaiters: nativeApprovalWaiters,
  onStartPhase: (conversationId) =>
    appEvents.publish(JSON.stringify({ kind: 'terminal_start', conversationId, runId: null })),
});
await nativeTerminals.recover();
const artifactPages = await startArtifactOrigin({
  db,
  chatFolders,
  port: artifactPortFor(config.API_PORT),
  frameAncestors: [`http://127.0.0.1:${config.API_PORT}`, ...config.ALLOWED_ORIGINS],
}).catch((error: unknown) => {
  console.error('Could not start the artifact page server', (error as Error).message);
  return null;
});
sparkPorts.add(nativeMcp.port).add(nativeTerminals.port);
desktopBrowser?.blockPorts([
  nativeMcp.port,
  nativeTerminals.port,
  artifactPortFor(config.API_PORT),
]);
const clones = cloneJobsFor(cloneDeps);
await clones.recover();
const { app, reconcileRemote } = createAppParts({
  clones,
  chatPorts,
  cloneTest: cloneDeps.cloneTest,
  db,
  hub,
  workspaceId,
  secrets,
  endpoints,
  sparkPorts,
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
  chatFolders,
  researchCopies,
  artifactOriginDown: artifactPages === null,
  terminals,
  nativeTerminals,
  previews,
  agentTerminals,
  appEvents,
  outposts,
  stackGit,
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
  pushKeys: remotePushKeys,
  pushTest: (deviceId) => pushNotifier.test(deviceId),
  calendarHost: desktopCalendar,
  googleCalendar,
  meetings,
  ...(config.AGENT_RUNTIME === 'fake' && config.PAIRING_TEST_ATTEMPTS_PER_MINUTE
    ? { pairingAttemptsPerMinute: config.PAIRING_TEST_ATTEMPTS_PER_MINUTE }
    : {}),
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
const archiveSweep = config.ARCHIVE_SWEEP ? startArchiveSweep(db, workspaceId) : null;
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
const weekRecap = config.WEEK_RECAP ? startWeekRecap(db, workspaceId) : null;

let pruneSchedule: PruneSchedule | null = null;
const server = app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
  pruneSchedule = schedulePrune({
    db,
    workspaceId,
    auditRetentionDays: config.AUDIT_RETENTION_DAYS,
    chatFolders,
    researchCopies,
  });
  void slackSocket.refresh();
  outposts.start();
  reconcileRemote().catch((error: unknown) => {
    console.error('Could not check Tailscale Serve', (error as Error).message);
  });
});
attachTerminalSockets(server, terminals, {
  port: config.API_PORT,
  allowedOrigins: config.ALLOWED_ORIGINS,
  apiToken,
});

let stopping = false;
const shutdown = async (keepTerminals = false) => {
  if (stopping) return;
  stopping = true;
  armShutdownWatchdog((code) => process.exit(code));
  await runShutdownSteps([
    ['clones', () => clones.stopAll()],
    [
      'Terminal sessions',
      () => (keepTerminals ? nativeTerminals.detach() : nativeTerminals.dispose()),
    ],
    ['terminals', () => terminals.killAll()],
    ['process kills', () => processKillsSent()],
    [
      'tmux',
      () => {
        if (terminalTmux.host && !keepTerminals) killTmuxServer(terminalTmux.host);
      },
    ],
    ['native MCP', () => nativeMcp.close()],
    ['artifact pages', () => artifactPages?.close()],
    ['approval listener', () => nativeApprovalListener.close()],
    ['calendar listener', () => calendarWrittenListener.close()],
    ['previews', () => previews.stopAll('shutdown')],
    ['agent terminals', () => agentTerminals.stopAll()],
    ['chat ports', () => chatPorts?.stop()],
    ['lag monitor', () => stopLagMonitor()],
    ['outcome sweep', () => outcomeSweep.stop()],
    ['archive sweep', () => archiveSweep?.stop()],
    ['prune schedule', () => pruneSchedule?.stop()],
    ['morning brief', () => morningBrief?.stop()],
    ['week recap', () => weekRecap?.stop()],
    ['Slack socket', () => slackSocket.stop()],
    ['Slack notifier', () => slackNotifier.stop()],
    ['calendar ticker', () => calendarTicker?.stop()],
    ['Google Calendar', () => googleCalendar?.stop()],
    ['push notifier', () => pushNotifier.stop()],
    ['outposts', () => outposts.close()],
    ['HTTP server', () => server.close()],
    ['HTTP connections', () => server.closeAllConnections()],
    ['database listener', () => listener.close()],
    ['app event listener', () => appEventListener.close()],
    ['pending process kills', () => processKillsSent()],
    ['database pool', () => db.end()],
  ]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.on('message', (message) => {
  if (isKeepTerminalsStop(message)) void shutdown(true);
});
