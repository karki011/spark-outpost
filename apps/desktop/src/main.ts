import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { createLaunchToken } from '../../server/src/api/launch-token.ts';
import { apiOrigin } from './api-token.ts';
import { waitForApi } from './api-ready.ts';
import { channelConfig, channelPaths, resolveChannel } from './channel.ts';
import { settingsFile } from './companion-settings.ts';
import { startCompanionHost, type CompanionHost } from './desktop-companion.ts';
import { detectGit, GIT_MISSING } from './git.ts';
import { appLayout } from './layout.ts';
import { freePort, LOOPBACK } from './ports.ts';
import { startDatabase, type Database } from './postgres.ts';
import { apiEnv, POSTGRES_LOCALE, workerEnv, type ServerLaunch } from './server-env.ts';
import { forkService, OutputTail } from './service.ts';
import { createShutdown } from './shutdown.ts';
import { Supervisor } from './supervisor.ts';
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
  companionHost?.dispose();
  companionHost = null;
  for (const open of BrowserWindow.getAllWindows()) open.destroy();
}

const shutdown = createShutdown({
  stop: stopEverything,
  closeWindow: closeWindows,
  showError: (message, detail) =>
    dialog.showMessageBox({
      type: 'error',
      title: `${config.appName} could not continue`,
      message,
      detail,
    }),
  exit: (code) => app.exit(code),
});

function fail(message: string, detail: string): void {
  if (!shutdown.failed.aborted) console.error(`[main] ${message}\n${detail}`);
  shutdown.fail(message, detail);
}

async function launch(): Promise<void> {
  if (config.badge) app.dock?.setBadge(config.badge);
  if (!(await detectGit())) await dialog.showMessageBox({ type: 'warning', ...GIT_MISSING });

  database = await startDatabase({
    dataDir: paths.postgresData,
    passwordFile: paths.postgresPassword,
    port: await freePort(),
    log: log('postgres'),
  });
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
    shutdown.quit();
  });
  app
    .whenReady()
    .then(launch)
    .catch((error: Error) => {
      fail('Startup failed.', error.message);
    });
}
