import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
} from 'electron';
import { BROWSER_HOST_ENV, isBetaVersion, parseSparkChatLink } from '@spark-outpost/contracts';
import { linkIn } from './deep-link.ts';
import { createLaunchToken } from '../../server/src/api/launch-token.ts';
import { stableApiPort } from './api-port.ts';
import { waitForApi } from './api-ready.ts';
import { appearanceFile, readSavedTheme, saveTheme } from './appearance.ts';
import { startBootTeasers } from './boot-teaser-host.ts';
import { prepareBoot, reportingSteps } from './boot-steps.ts';
import { channelConfig, channelIcons, channelPaths, resolveChannel } from './channel.ts';
import { settingsFile } from './companion-settings.ts';
import { startCompanionHost, type CompanionHost } from './desktop-companion.ts';
import { detectGit, GIT_MISSING } from './git.ts';
import { appLayout } from './layout.ts';
import { freePort, LOOPBACK, portIsFree } from './ports.ts';
import { DUMP_TOOL_DIRS } from './data-backup.ts';
import { guardDownloads } from './downloads.ts';
import { FileLog } from './file-log.ts';
import { scheduleHeartbeat, type HeartbeatTimer } from './heartbeat.ts';
import { startHelp, type Help } from './help.ts';
import { aboutVersion } from './help-menu.ts';
import type { Database, DatabaseOptions } from './postgres.ts';
import { LocalRuntime } from './runtime-client.ts';
import { serverEntry } from './runtime-entries.ts';
import { startPrivacy, type Privacy } from './privacy.ts';
import {
  apiEnv,
  browserWorkerEnv,
  POSTGRES_LOCALE,
  workerEnv,
  type ServerLaunch,
} from './server-env.ts';
import { startBrowserHost, type DesktopBrowserHost } from './browser/host.ts';
import type { ServiceOptions } from './service.ts';
import { RuntimeServices } from './runtime-services.ts';
import { createShutdown } from './shutdown.ts';
import { bakedSignInEnv, deliverSlackCallback, isSlackCallback } from './slack-sign-in.ts';
import { adoptLoginShellPath } from './shell-path.ts';
import { startupMigrationEffects } from './startup-migration.ts';
import {
  failureDialog,
  isMigrationFailure,
  previousVersionInstructions,
} from './update-failure.ts';
import { readFeedUrl, updateConfigFile } from './update-feed.ts';
import { guardMigrations, readSkippedVersion, skippedVersionFile } from './update-migration.ts';
import { startUpdater, type Updater } from './updater.ts';
import { fetchActiveRuns } from './active-runs.ts';
import { apiOrigin, targetsApi } from './api-token.ts';
import { IPC } from './ipc-channels.ts';
import { openSparkWindow, type SparkWindow } from './spark-window.ts';
import { startStorageSync, type StorageSync } from './storage-sync.ts';
import { isThemeName } from './theme-arg.ts';
import { webStorageFile } from './web-storage.ts';
import { attachApiToken } from './window.ts';

const config = channelConfig(resolveChannel(app.isPackaged));
const paths = channelPaths(process.env.SPARK_APP_DATA ?? app.getPath('appData'), config);
const layout = appLayout({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
});
const serverDir = layout.serverDir;
const bootstrap = path.join(import.meta.dirname, 'server-entry.js');
const preload = path.join(import.meta.dirname, 'preload.cjs');
const bootPreload = path.join(import.meta.dirname, 'boot-preload.cjs');
const icons = channelIcons(path.join(app.getAppPath(), 'assets'), config);

app.setName(config.appName);
app.setAboutPanelOptions({
  applicationName: config.appName,
  ...aboutVersion(app.getVersion(), isBetaVersion(app.getVersion())),
  iconPath: icons.app,
});
app.setPath('userData', paths.userData);
app.setAppLogsPath(paths.logs);
process.env.LC_ALL = POSTGRES_LOCALE;

let database: Database | null = null;
let runtime: LocalRuntime | null = null;
let services: RuntimeServices | null = null;
let spark: SparkWindow | null = null;
let origin: string | null = null;
let savedTheme: string | null = null;
let companionHost: CompanionHost | null = null;
let pendingLinkChat: string | null = null;
let localApi: { origin: string; token: string } | null = null;
let failureHelp: string | null = null;
let updater: Updater | null = null;
let help: Help | null = null;
let privacy: Privacy | null = null;
let heartbeat: HeartbeatTimer | null = null;
let storage: StorageSync | null = null;
let browser: DesktopBrowserHost | null = null;
const fileLog = new FileLog({ dir: paths.logs });

function log(source: string) {
  return (line: string) => {
    console.log(`[${source}] ${line}`);
    fileLog.write(source, line);
  };
}

const mainLog = log('main');
const bootTeasers = startBootTeasers({
  userData: paths.userData,
  version: app.getVersion(),
  log: log('teasers'),
});

function supervise(
  name: string,
  entry: string,
  env: NodeJS.ProcessEnv,
  ready: () => boolean,
  connect?: ServiceOptions['connect'],
) {
  services!.start(
    {
      name,
      bootstrap,
      entry,
      cwd: serverDir,
      env,
      log: log(name),
      ...(connect ? { connect } : {}),
    },
    ready,
  );
}

async function stopEverything(): Promise<void> {
  await bootTeasers.saveNow();
  await services?.stop();
  services = null;
  mainLog('API and worker stopped; stopping the local runtime.');
  await runtime?.stop();
  runtime = null;
  database = null;
  mainLog('Stopped.');
}

function closeWindows(): void {
  storage?.dispose();
  storage = null;
  browser?.dispose();
  browser = null;
  heartbeat?.dispose();
  heartbeat = null;
  updater?.dispose();
  updater = null;
  help?.dispose();
  help = null;
  privacy?.dispose();
  privacy = null;
  companionHost?.dispose();
  companionHost = null;
  for (const open of BrowserWindow.getAllWindows()) open.destroy();
}

async function showError(message: string, detail: string): Promise<void> {
  const help = failureHelp;
  const buttons = help ? ['Open previous version instructions', 'Quit'] : ['OK'];
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: `${config.appName} could not continue`,
    message,
    detail,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
  });
  if (help && response === 0) await shell.openPath(help);
}

const shutdown = createShutdown({
  stop: stopEverything,
  closeWindow: closeWindows,
  showError,
  exit: (code) => app.exit(code),
});

function fail(message: string, detail: string): void {
  if (!shutdown.failed.aborted) {
    console.error(`[main] ${message}\n${detail}`);
    fileLog.write('main', `${message}\n${detail}`);
  }
  shutdown.fail(message, detail);
}

async function migrateBeforeStart(launchInfo: ServerLaunch, options: DatabaseOptions) {
  const effects = startupMigrationEffects({
    paths,
    migrationsDir: path.join(serverDir, 'migrations'),
    toolDirs: [path.join(process.resourcesPath, 'postgres-tools/bin'), ...DUMP_TOOL_DIRS],
    databaseUrl: () => launchInfo.databaseUrl,
    stopDatabase: async () => {
      await database?.stop();
      database = null;
    },
    startDatabase: async () => {
      database = await runtime!.database(options);
    },
    runMigrate: () =>
      services!.once({
        name: 'Spark Outpost Migrate',
        bootstrap,
        entry: serverEntry(serverDir, 'migrate'),
        cwd: serverDir,
        env: workerEnv(launchInfo),
        log: log('migrate'),
      }),
    log: log('migrate'),
  });
  const result = await guardMigrations(
    app.getVersion(),
    reportingSteps(effects, (step) => spark?.status(step)),
  );
  if (!isMigrationFailure(result)) return true;
  const context = {
    appName: config.appName,
    version: app.getVersion(),
    arch: process.arch,
    feedUrl: await readFeedUrl(updateConfigFile(process.resourcesPath)),
    userData: paths.userData,
  };
  const instructions = path.join(paths.userData, 'previous-version-instructions.txt');
  await writeFile(instructions, previousVersionInstructions(result, context));
  failureHelp = instructions;
  const { message, detail } = failureDialog(result, context);
  fail(message, detail);
  return false;
}

function listenForTheme(): void {
  const file = appearanceFile(paths.userData);
  let saving = Promise.resolve();
  ipcMain.on(IPC.themeSave, (event, theme: unknown) => {
    if (!origin || !targetsApi(event.senderFrame?.url ?? '', origin) || !isThemeName(theme)) return;
    if (theme === savedTheme) return;
    savedTheme = theme;
    saving = saving
      .then(() => saveTheme(file, theme))
      .catch((error: Error) => mainLog(`Could not save the theme: ${error.message}`));
  });
}

function quitAfterSaving(): void {
  void (storage?.capture() ?? Promise.resolve()).finally(() => shutdown.quit());
}

async function launch(): Promise<void> {
  savedTheme = await readSavedTheme(appearanceFile(paths.userData));
  listenForTheme();
  showSpark();
  if (!app.isPackaged) app.dock?.setIcon(icons.app);
  if (config.badge) app.dock?.setBadge(config.badge);

  runtime = await LocalRuntime.connect({
    userData: paths.userData,
    version: app.getVersion(),
    serverDir,
    bootstrap: path.join(import.meta.dirname, 'runtime-host.js'),
    log: (name, line) => log(name)(line),
  });
  services = new RuntimeServices(runtime, fail, mainLog);
  const existingRuntime = await runtime.info();
  const databaseOptions: DatabaseOptions = {
    dataDir: paths.postgresData,
    passwordFile: paths.postgresPassword,
    port: existingRuntime.database?.port ?? (await freePort()),
    log: log('postgres'),
  };
  spark?.status('database');
  const started = await prepareBoot({
    startDatabase: async () => {
      database = await runtime!.database(databaseOptions);
      return database;
    },
    adoptShellPath: async () => {
      if (app.isPackaged) await adoptLoginShellPath(process.env);
    },
    checkTools: async () => {
      if (!(await detectGit())) await dialog.showMessageBox({ type: 'warning', ...GIT_MISSING });
    },
  });
  const apiPort =
    existingRuntime.api?.port ??
    (await stableApiPort(paths.userData, {
      isFree: portIsFree,
      fallback: freePort,
      log: mainLog,
    }));
  const apiUrl = apiOrigin(LOOPBACK, apiPort);
  const token = existingRuntime.api?.token ?? createLaunchToken();
  const launchInfo: ServerLaunch = {
    config,
    paths,
    databaseUrl: started.url,
    apiPort,
    apiOrigin: apiUrl,
    token,
    version: app.getVersion(),
    webRoot: layout.webRoot,
    baseEnv: {
      ...(await bakedSignInEnv(app.getAppPath())),
      ...process.env,
    },
  };
  if (!existingRuntime.api && !(await migrateBeforeStart(launchInfo, databaseOptions))) return;
  await runtime.configure({ port: apiPort, token, version: app.getVersion() });

  spark?.status('spark');
  const browserHost = await startBrowserHost({
    window: () => spark?.window ?? null,
    trusted: (event) => targetsApi(event.senderFrame?.url ?? '', apiUrl),
    userData: paths.userData,
    blockedPorts: [apiPort, databaseOptions.port],
    log: log('browser'),
  });
  browser = browserHost;
  let apiReady = false;
  supervise(
    'Spark Outpost API',
    serverEntry(serverDir, 'api'),
    { ...apiEnv(launchInfo), [BROWSER_HOST_ENV]: '1' },
    () => apiReady,
    (port) => browserHost.connectWorker(port),
  );
  await waitForApi(apiUrl, token, shutdown.failed);
  apiReady = true;
  supervise(
    'Spark Outpost Worker',
    serverEntry(serverDir, 'worker'),
    browserWorkerEnv(launchInfo),
    () => true,
    (port) => browserHost.connectWorker(port),
  );

  attachApiToken(apiUrl, token);
  localApi = { origin: apiUrl, token };
  guardDownloads(session.defaultSession, {
    focus: () => spark?.focus(),
    log: log('downloads'),
  });
  storage = await startStorageSync({
    file: webStorageFile(paths.userData),
    origin: apiUrl,
    log: log('settings'),
  });
  origin = apiUrl;
  if (spark) spark.loadApp(apiUrl);
  else showSpark();
  help = startHelp({
    version: app.getVersion(),
    logsFolder: paths.logs,
    apiUrl,
    token,
    trusted: (event) => targetsApi(event.senderFrame?.url ?? '', apiUrl),
    showSpark,
    mainWindow: () => spark?.window ?? null,
    log: log('help'),
  });
  privacy = startPrivacy({
    trusted: (event) => targetsApi(event.senderFrame?.url ?? '', apiUrl),
  });
  updater = await startUpdater({
    enabled: config.autoUpdate,
    version: app.getVersion(),
    userData: paths.userData,
    feedUrl: await readFeedUrl(updateConfigFile(process.resourcesPath)),
    skippedVersion: await readSkippedVersion(skippedVersionFile(paths.userData)),
    preview: app.isPackaged ? undefined : process.env.SPARK_UPDATE_PREVIEW,
    activeRuns: () => fetchActiveRuns(apiUrl, token),
    trusted: (event) => targetsApi(event.senderFrame?.url ?? '', apiUrl),
    broadcast: (status) => {
      for (const open of BrowserWindow.getAllWindows()) {
        if (!open.isDestroyed()) open.webContents.send(IPC.updatesChanged, status);
      }
    },
    quit: quitAfterSaving,
    relaunch: () => {
      app.relaunch();
      quitAfterSaving();
    },
    log: log('updates'),
  });
  heartbeat = await scheduleHeartbeat({
    apiUrl,
    token,
    version: app.getVersion(),
    appPath: app.getAppPath(),
    userData: paths.userData,
    devChannel: config.channel === 'dev',
    env: process.env,
  });
  bootTeasers.watch(apiUrl, token);
  companionHost = await startCompanionHost({
    appName: config.appName,
    origin: apiUrl,
    preload,
    settingsPath: settingsFile(paths.userData),
    trayIcon: icons.tray,
    showSpark,
    quit: () => app.quit(),
    log: mainLog,
  });
  if (app.isPackaged) app.setAsDefaultProtocolClient(config.linkScheme);
  if (pendingLinkChat) companionHost.openChat(pendingLinkChat);
  pendingLinkChat = null;
  void spark?.finished.then(() => companionHost?.companion.resume());
  mainLog(`${config.appName} ${app.getVersion()} ready on ${apiUrl}; data in ${paths.userData}.`);
}

function openSpark(): SparkWindow {
  const opened = openSparkWindow({
    config,
    preload,
    bootPreload,
    bootPage: path.join(layout.webRoot, 'boot.html'),
    theme: savedTheme,
    log: mainLog,
  });
  opened.window.on('closed', () => {
    browser?.windowClosed();
    if (spark === opened) spark = null;
  });
  if (origin) opened.loadApp(origin);
  return opened;
}

function openLink(url: string | null): void {
  if (url && localApi && isSlackCallback(url, config.linkScheme)) {
    void deliverSlackCallback(localApi, url);
  }
  const chatId = url ? parseSparkChatLink(url, config.linkScheme) : null;
  if (!chatId) {
    showSpark();
    return;
  }
  if (companionHost) companionHost.openChat(chatId);
  else pendingLinkChat = chatId;
}

function showSpark(): void {
  if (shutdown.failed.aborted) return;
  if (!spark) {
    spark = openSpark();
    return;
  }
  spark.focus();
  app.focus({ steal: true });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => openLink(linkIn(argv, config.linkScheme)));
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  app.on('activate', showSpark);
  app.on('window-all-closed', () => undefined);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
  nativeUpdater.on('before-quit-for-update', () => {
    companionHost?.dispose();
    companionHost = null;
  });
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (updater?.takeOverQuit()) return;
    quitAfterSaving();
  });
  app
    .whenReady()
    .then(launch)
    .catch((error: Error) => {
      fail('Startup failed.', error.message);
    });
}
