import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { createLaunchToken } from '../../server/src/api/launch-token.ts';
import { waitForApi } from './api-ready.ts';
import { channelConfig, channelPaths, resolveChannel } from './channel.ts';
import { settingsFile } from './companion-settings.ts';
import { startCompanionHost, type CompanionHost } from './desktop-companion.ts';
import { detectGit, GIT_MISSING } from './git.ts';
import { appLayout } from './layout.ts';
import { freePort, LOOPBACK } from './ports.ts';
import { DUMP_TOOL_DIRS } from './data-backup.ts';
import { startDatabase, type Database, type DatabaseOptions } from './postgres.ts';
import { apiEnv, POSTGRES_LOCALE, workerEnv, type ServerLaunch } from './server-env.ts';
import { forkService, OutputTail } from './service.ts';
import { createShutdown } from './shutdown.ts';
import { startupMigrationEffects } from './startup-migration.ts';
import { Supervisor } from './supervisor.ts';
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
import { attachApiToken, openWindow } from './window.ts';

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

app.setName(config.appName);
app.setPath('userData', paths.userData);
app.setAppLogsPath(paths.logs);
process.env.LC_ALL = POSTGRES_LOCALE;

let database: Database | null = null;
const supervisors: Supervisor[] = [];
let window: BrowserWindow | null = null;
let origin: string | null = null;
let companionHost: CompanionHost | null = null;
let failureHelp: string | null = null;
let updater: Updater | null = null;

function log(source: string) {
  return (line: string) => console.log(`[${source}] ${line}`);
}

function supervise(name: string, entry: string, env: NodeJS.ProcessEnv, ready: () => boolean) {
  const tail = new OutputTail();
  const supervisor = new Supervisor({
    start: () => forkService({ name, bootstrap, entry, cwd: serverDir, env, log: log(name) }, tail),
    onRestart: (delayMs, code) => {
      if (!ready()) {
        fail(`${name} stopped during startup (exit ${code}).`, tail.text());
        return;
      }
      console.log(`[main] ${name} exited with ${code}; restarting in ${delayMs} ms.`);
    },
    onGiveUp: (code) => fail(`${name} keeps stopping (last exit ${code}).`, tail.text()),
  });
  supervisors.push(supervisor);
  supervisor.start();
}

async function stopEverything(): Promise<void> {
  await Promise.all(supervisors.map((supervisor) => supervisor.stop()));
  console.log('[main] API and worker stopped; stopping Postgres.');
  await database?.stop();
  database = null;
  console.log('[main] Stopped.');
}

function closeWindows(): void {
  updater?.dispose();
  updater = null;
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
  if (!shutdown.failed.aborted) console.error(`[main] ${message}\n${detail}`);
  shutdown.fail(message, detail);
}

async function runOnce(name: string, entry: string, env: NodeJS.ProcessEnv) {
  const tail = new OutputTail();
  const service = forkService(
    { name, bootstrap, entry, cwd: serverDir, env, log: log(name) },
    tail,
  );
  const code = await service.exited;
  return code === 0
    ? { ok: true as const }
    : { ok: false as const, detail: tail.text() || `The migration exited with ${code}.` };
}

async function migrateBeforeStart(launchInfo: ServerLaunch, options: DatabaseOptions) {
  const result = await guardMigrations(
    app.getVersion(),
    startupMigrationEffects({
      paths,
      migrationsDir: path.join(serverDir, 'migrations'),
      toolDirs: [path.join(process.resourcesPath, 'postgres-tools/bin'), ...DUMP_TOOL_DIRS],
      databaseUrl: () => launchInfo.databaseUrl,
      stopDatabase: async () => {
        await database?.stop();
        database = null;
      },
      startDatabase: async () => {
        database = await startDatabase(options);
      },
      runMigrate: () =>
        runOnce(
          'Spark Outpost Migrate',
          path.join(serverDir, 'src/persistence/migrate-cli.ts'),
          workerEnv(launchInfo),
        ),
      log: log('migrate'),
    }),
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

async function launch(): Promise<void> {
  if (config.badge) app.dock?.setBadge(config.badge);
  if (!(await detectGit())) await dialog.showMessageBox({ type: 'warning', ...GIT_MISSING });

  const databaseOptions: DatabaseOptions = {
    dataDir: paths.postgresData,
    passwordFile: paths.postgresPassword,
    port: await freePort(),
    log: log('postgres'),
  };
  database = await startDatabase(databaseOptions);
  const apiPort = await freePort();
  const apiUrl = apiOrigin(LOOPBACK, apiPort);
  const token = createLaunchToken();
  const launchInfo: ServerLaunch = {
    config,
    paths,
    databaseUrl: database.url,
    apiPort,
    apiOrigin: apiUrl,
    token,
    webRoot: layout.webRoot,
    baseEnv: process.env,
  };
  if (!(await migrateBeforeStart(launchInfo, databaseOptions))) return;

  let apiReady = false;
  supervise(
    'Spark Outpost API',
    path.join(serverDir, 'src/api/main.ts'),
    apiEnv(launchInfo),
    () => apiReady,
  );
  await waitForApi(apiUrl, token, shutdown.failed);
  apiReady = true;
  supervise(
    'Spark Outpost Worker',
    path.join(serverDir, 'src/workflow/main.ts'),
    workerEnv(launchInfo),
    () => true,
  );

  attachApiToken(apiUrl, token);
  origin = apiUrl;
  showSpark();
  updater = await startUpdater({
    enabled: config.autoUpdate,
    version: app.getVersion(),
    userData: paths.userData,
    feedUrl: await readFeedUrl(updateConfigFile(process.resourcesPath)),
    skippedVersion: await readSkippedVersion(skippedVersionFile(paths.userData)),
    activeRuns: () => fetchActiveRuns(apiUrl, token),
    trusted: (event) => targetsApi(event.senderFrame?.url ?? '', apiUrl),
    broadcast: (status) => {
      for (const open of BrowserWindow.getAllWindows()) {
        if (!open.isDestroyed()) open.webContents.send(IPC.updatesChanged, status);
      }
    },
    quit: () => shutdown.quit(),
    log: log('updates'),
  });
  companionHost = await startCompanionHost({
    appName: config.appName,
    origin: apiUrl,
    preload,
    settingsPath: settingsFile(paths.userData),
    showSpark,
    quit: () => app.quit(),
  });
  console.log(`[main] ${config.appName} ready on ${apiUrl}; data in ${paths.userData}.`);
}

function showSpark(): void {
  if (!origin || shutdown.failed.aborted) return;
  if (!window) {
    window = openWindow({ config, origin, preload });
    window.on('closed', () => {
      window = null;
    });
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  app.focus({ steal: true });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showSpark);
  app.on('activate', showSpark);
  app.on('window-all-closed', () => {
    if (!companionHost?.companion.running()) app.quit();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (updater?.takeOverQuit()) return;
    shutdown.quit();
  });
  app
    .whenReady()
    .then(launch)
    .catch((error: Error) => {
      fail('Startup failed.', error.message);
    });
}
