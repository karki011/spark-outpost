import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import { createLaunchToken } from '../../server/src/api/launch-token.ts';
import { apiOrigin } from './api-token.ts';
import { waitForApi } from './api-ready.ts';
import { channelConfig, channelPaths, resolveChannel } from './channel.ts';
import { detectGit, GIT_MISSING } from './git.ts';
import { freePort, LOOPBACK } from './ports.ts';
import { startDatabase, type Database } from './postgres.ts';
import { apiEnv, POSTGRES_LOCALE, workerEnv, type ServerLaunch } from './server-env.ts';
import { forkService, OutputTail } from './service.ts';
import { Supervisor } from './supervisor.ts';
import { attachApiToken, openWindow } from './window.ts';

const config = channelConfig(resolveChannel(app.isPackaged));
const paths = channelPaths(app.getPath('appData'), config);
const repoRoot = path.resolve(app.getAppPath(), '../..');
const serverDir = path.join(repoRoot, 'apps/server');
const bootstrap = path.join(import.meta.dirname, 'server-entry.js');

app.setName(config.appName);
app.setPath('userData', paths.userData);
app.setAppLogsPath(paths.logs);
process.env.LC_ALL = POSTGRES_LOCALE;

let database: Database | null = null;
const supervisors: Supervisor[] = [];
const startupFailed = new AbortController();
let window: BrowserWindow | null = null;
let stopping: Promise<void> | null = null;

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

function stopAll(): Promise<void> {
  stopping ??= stopEverything();
  return stopping;
}

function fail(message: string, detail: string): void {
  if (startupFailed.signal.aborted) return;
  console.error(`[main] ${message}\n${detail}`);
  startupFailed.abort();
  window?.destroy();
  void stopAll()
    .then(() =>
      dialog.showMessageBox({
        type: 'error',
        title: `${config.appName} could not continue`,
        message,
        detail,
      }),
    )
    .finally(() => app.exit(1));
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
  const origin = apiOrigin(LOOPBACK, apiPort);
  const token = createLaunchToken();
  const launchInfo: ServerLaunch = {
    config,
    paths,
    databaseUrl: database.url,
    apiPort,
    apiOrigin: origin,
    token,
    webRoot: path.join(repoRoot, 'apps/web/dist'),
    baseEnv: process.env,
  };

  let apiReady = false;
  supervise(
    'Spark Outpost API',
    path.join(serverDir, 'src/api/main.ts'),
    apiEnv(launchInfo),
    () => apiReady,
  );
  await waitForApi(origin, token, startupFailed.signal);
  apiReady = true;
  supervise(
    'Spark Outpost Worker',
    path.join(serverDir, 'src/workflow/main.ts'),
    workerEnv(launchInfo),
    () => true,
  );

  attachApiToken(origin, token);
  window = openWindow({ config, origin });
  window.on('closed', () => {
    window = null;
  });
  console.log(`[main] ${config.appName} ready on ${origin}; data in ${paths.userData}.`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
  app.on('before-quit', (event) => {
    event.preventDefault();
    void stopAll().finally(() => app.exit(0));
  });
  app
    .whenReady()
    .then(launch)
    .catch((error: Error) => {
      if (!startupFailed.signal.aborted) fail('Startup failed.', error.message);
    });
}
