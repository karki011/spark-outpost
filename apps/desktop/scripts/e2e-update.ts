import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { MacArch } from './builder-config.ts';
import { packageDesktop, releaseDir } from './stage.ts';

const work = path.join(releaseDir, 'e2e');
const feedDir = path.join(work, 'feed');
const installDir = path.join(os.tmpdir(), 'spark-outpost-e2e-applications');
const appData = await mkdtemp('/tmp/spark-e2e-');
const userData = path.join(appData, 'Spark Outpost');
const PACKAGE_NAME = 'spark-outpost-e2e';
const APP_ID = 'ai.spark-outpost.app.e2e';
const caches = path.join(os.homedir(), 'Library/Caches');
const updaterCache = path.join(caches, `${PACKAGE_NAME}-updater`);
const testCaches = [updaterCache, path.join(caches, APP_ID), path.join(caches, `${APP_ID}.ShipIt`)];
const arch: MacArch = os.arch() === 'arm64' ? 'arm64' : 'x64';
const appName = 'Spark Outpost.app';
const signingName = process.env.CSC_NAME;
const DEBUG_PORT = 39222;
const GOOD_MIGRATION = ['9990_e2e_update.sql', 'CREATE TABLE e2e_update (id int PRIMARY KEY);'];
const BROKEN_MIGRATION = [
  '9991_e2e_broken.sql',
  'CREATE TABLE e2e_broken (id int REFERENCES nope);',
];

const zipRanges: number[] = [];

const runningApps = new Set<Running>();

const results: { check: string; outcome: 'verified' | 'blocked' | 'failed'; detail: string }[] = [];

function record(check: string, outcome: 'verified' | 'blocked' | 'failed', detail = ''): void {
  results.push({ check, outcome, detail });
  console.log(`[e2e] ${outcome.toUpperCase()}: ${check}${detail ? ` — ${detail}` : ''}`);
}

function serveFeed(): Promise<Server> {
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? '/', 'http://feed').pathname.slice(1));
    const file = path.join(feedDir, path.basename(name));
    if (!name || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const wanted = request.headers.range ?? '';
    if (wanted.includes(',')) {
      console.log(`[feed] ${request.method} ${name} refused ${wanted.split(',').length} ranges`);
      response.writeHead(400, { 'Content-Type': 'text/html' }).end('<html>Bad Request</html>');
      return;
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(wanted);
    if (range) {
      const [start, end] = [Number(range[1]), Number(range[2])];
      if (name.endsWith('.zip')) zipRanges.push(end - start + 1);
      else console.log(`[feed] ${request.method} ${name} ${wanted}`);
      response.writeHead(206, { 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    console.log(`[feed] ${request.method} ${name}`);
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function buildEnv(feedUrl: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('APPLE_') || name.startsWith('CSC_')) delete env[name];
  }
  const signing = signingName
    ? { CSC_NAME: signingName }
    : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  return { ...env, SPARK_UPDATE_FEED_URL: feedUrl, ...signing };
}

async function addMigrations(serverDir: string, migrations: string[][]): Promise<void> {
  for (const [name, sql] of migrations) {
    await writeFile(path.join(serverDir, 'migrations', name!), `${sql}\n`);
  }
}

async function buildVersion(version: string, feedUrl: string, migrations: string[][]) {
  const outputDir = path.join(work, version);
  console.log(`[e2e] Packaging ${version} for ${arch}…`);
  await packageDesktop({
    version,
    archs: [arch],
    outputDir,
    env: buildEnv(feedUrl),
    packageName: PACKAGE_NAME,
    appId: APP_ID,
    formats: ['zip'],
    prepareServer: (serverDir) => addMigrations(serverDir, migrations),
  });
  return outputDir;
}

async function publish(outputDir: string, previousDir: string): Promise<void> {
  for (const name of await readdir(outputDir)) {
    if (/\.(zip|blockmap|yml|html)$/.test(name) && !name.startsWith('builder-')) {
      await cp(path.join(outputDir, name), path.join(feedDir, name));
    }
  }
  for (const name of await readdir(previousDir)) {
    if (name.endsWith('.zip.blockmap'))
      await cp(path.join(previousDir, name), path.join(feedDir, name));
  }
}

async function seedPreviousUpdate(outputDir: string, version: string): Promise<void> {
  await mkdir(updaterCache, { recursive: true });
  await cp(
    path.join(outputDir, `Spark-Outpost-${version}-${arch}.zip`),
    path.join(updaterCache, 'update.zip'),
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function install(outputDir: string): Promise<string> {
  const target = path.join(installDir, appName);
  await rm(target, { recursive: true, force: true });
  await mkdir(installDir, { recursive: true });
  await cp(path.join(outputDir, arch === 'arm64' ? 'mac-arm64' : 'mac', appName), target, {
    recursive: true,
    verbatimSymlinks: true,
  });
  return target;
}

interface Running {
  child: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
  error?: Error;
}

function launch(app: string, args: string[] = []): Running {
  const child = spawn(path.join(app, 'Contents/MacOS/Spark Outpost'), args, {
    env: { ...process.env, SPARK_APP_DATA: appData },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      lines.push(line);
      if (!line.startsWith('[postgres]')) console.log(`  ${line.slice(0, 240)}`);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', resolve);
    child.once('error', (error) => {
      running.error = error;
      resolve(null);
    });
  });
  const running: Running = { child, lines, exited };
  runningApps.add(running);
  void exited.then(() => runningApps.delete(running));
  return running;
}

async function waitForLine(running: Running, pattern: RegExp, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = running.lines.find((line) => pattern.test(line));
    if (found) return found;
    const failure = running.lines.find((line) => line.includes('[main] Startup failed.'));
    if (failure || running.error || !runningApps.has(running)) {
      throw new Error(
        `App stopped before ${pattern}: ${running.error?.message ?? failure ?? `exit ${running.child.exitCode}, signal ${running.child.signalCode}`}\n${running.lines.slice(-8).join('\n')}`,
      );
    }
    await delay(500);
  }
  return null;
}

async function quit(running: Running, timeoutMs = 90_000): Promise<number | null | 'timeout'> {
  running.child.kill('SIGTERM');
  const code = await Promise.race([
    running.exited,
    delay(timeoutMs).then(() => 'timeout' as const),
  ]);
  if (code === 'timeout') running.child.kill('SIGKILL');
  return code;
}

async function bundleVersion(app: string): Promise<string | null> {
  const plist = await readFile(path.join(app, 'Contents/Info.plist'), 'utf8');
  return (
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null
  );
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function updateCycle(v1: string): Promise<void> {
  const app = await install(v1);
  await seedPreviousUpdate(v1, '0.0.1');
  const running = launch(app, signingName ? [`--remote-debugging-port=${DEBUG_PORT}`] : []);
  const ready = await waitForLine(running, /\[main\] Spark Outpost \S* ?ready on/, 120_000);
  record(
    '0.0.1 packaged app launches, migrates a fresh database and serves the window',
    ready ? 'verified' : 'failed',
  );
  const staged = await waitForLine(running, /\[updates\] Update ready 0\.0\.2\./, 180_000);
  record(
    'updater detects 0.0.2 on the generic feed and downloads it in the background',
    staged ? 'verified' : 'failed',
  );
  const pending = path.join(updaterCache, 'pending');
  const files = existsSync(pending) ? await readdir(pending) : [];
  const zip = files.find((name) => name.endsWith('.zip'));
  record(
    'the update zip is staged in the updater cache with its sha512-checked info',
    zip && files.includes('update-info.json') ? 'verified' : 'failed',
    zip ? `${zip}, ${(await stat(path.join(pending, zip))).size} bytes` : files.join(', '),
  );
  const plan = running.lines.find((line) => /Full: .*To download: /.test(line));
  const fellBack = running.lines.find((line) => /Cannot download differentially/.test(line));
  const fetched = zipRanges.reduce((sum, size) => sum + size, 0);
  const size = zip ? (await stat(path.join(pending, zip))).size : 0;
  record(
    'differential download from the blockmaps with single-range requests (multi-range refused like R2)',
    staged && plan && !fellBack && zipRanges.length > 0 && fetched < size ? 'verified' : 'failed',
    fellBack?.slice(0, 200) ??
      `${zipRanges.length} range requests, ${megabytes(fetched)} of ${megabytes(size)} fetched`,
  );
  if (signingName) {
    await restartToUpdate(app, running);
    return;
  }
  const code = await quit(running);
  const squirrel = running.lines.filter((line) =>
    /Squirrel|code signature|ShipIt|signature/i.test(line),
  );
  const installed = await bundleVersion(app);
  record(
    'install on quit hands the staged zip to Squirrel.Mac',
    installed === '0.0.2' ? 'verified' : 'blocked',
    installed === '0.0.2'
      ? 'bundle replaced'
      : `bundle still ${installed}; Squirrel.Mac refuses updates whose code signature does not match a Developer ID designated requirement. Exit ${code}. ${squirrel.slice(-2).join(' | ')}`,
  );
}

interface DebugPage {
  url: string;
  webSocketDebuggerUrl: string;
}

async function clickRestartToUpdate(): Promise<void> {
  const pages = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()) as DebugPage[];
  const page = pages.find((entry) => /^http/.test(entry.url) && !entry.url.includes('/island'));
  if (!page) throw new Error('The main window is not open.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'window.sparkDesktop.updates.install()', awaitPromise: true },
    }),
  );
  await delay(1_000);
  socket.close();
}

async function untilInstalled(app: string, version: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await bundleVersion(app).catch(() => null)) === version) return true;
    await delay(1_000);
  }
  return false;
}

function stopRelaunched(): void {
  try {
    execFileSync('pkill', ['-f', installDir]);
  } catch {
    return;
  }
}

async function restartToUpdate(app: string, running: Running): Promise<void> {
  execFileSync('launchctl', ['setenv', 'SPARK_APP_DATA', appData]);
  try {
    await clickRestartToUpdate();
    const exited = await Promise.race([running.exited, delay(90_000).then(() => 'timeout')]);
    const installed = exited !== 'timeout' && (await untilInstalled(app, '0.0.2', 300_000));
    record(
      'Restart to update quits with the island open, and Squirrel.Mac replaces the bundle',
      installed ? 'verified' : 'failed',
      exited === 'timeout' ? 'the app never quit' : `bundle is ${await bundleVersion(app)}`,
    );
    if (exited === 'timeout') running.child.kill('SIGKILL');
    await delay(10_000);
  } finally {
    stopRelaunched();
    execFileSync('launchctl', ['unsetenv', 'SPARK_APP_DATA']);
  }
}

async function backupFrom(version: string): Promise<string | undefined> {
  const dir = path.join(userData, 'backups');
  const files = existsSync(dir) ? await readdir(dir) : [];
  return files.find((file) => file.endsWith(`-from-${version}.dump`));
}

async function migrationCycle(v2: string, v3: string): Promise<void> {
  const second = launch(await install(v2));
  const ready = await waitForLine(second, /\[main\] Spark Outpost \S* ?ready on/, 120_000);
  const backedUp =
    second.lines.find((line) => /\[migrate\] Backed up the database/.test(line)) ??
    (await backupFrom('0.0.1'));
  const marker = await readJson(path.join(userData, 'migrated-version.json'));
  record(
    '0.0.2 backs up before its new migration, migrates and records the version',
    ready && backedUp && marker?.version === '0.0.2' ? 'verified' : 'failed',
    backedUp?.replace(/^.*\): /, '') ?? 'no backup line',
  );
  await quit(second);

  const third = launch(await install(v3));
  const restored = await waitForLine(third, /\[migrate\] Restored the database from/, 120_000);
  await delay(3_000);
  const instructions = path.join(userData, 'previous-version-instructions.txt');
  const skipped = await readJson(path.join(userData, 'skipped-update.json'));
  const still = await readJson(path.join(userData, 'migrated-version.json'));
  record(
    '0.0.3 with a failing migration restores the backup, offers previous-version instructions and skips 0.0.3',
    restored &&
      existsSync(instructions) &&
      skipped?.version === '0.0.3' &&
      still?.version === '0.0.2'
      ? 'verified'
      : 'failed',
  );
  third.child.kill('SIGKILL');
  await third.exited;

  const again = launch(await install(v2));
  const reopened = await waitForLine(again, /\[main\] Spark Outpost \S* ?ready on/, 120_000);
  record('0.0.2 opens the restored data again', reopened ? 'verified' : 'failed');
  await quit(again);
  const backups = existsSync(path.join(userData, 'backups'))
    ? await readdir(path.join(userData, 'backups'))
    : [];
  record(
    'update backups kept',
    backups.length > 0 && backups.length <= 3 ? 'verified' : 'failed',
    backups.join(', '),
  );
}

async function removeTestCaches(): Promise<void> {
  for (const dir of [...testCaches, installDir]) await rm(dir, { recursive: true, force: true });
  const byHost = path.join(os.homedir(), 'Library/Preferences/ByHost');
  for (const name of existsSync(byHost) ? await readdir(byHost) : []) {
    if (name.startsWith(`${APP_ID}.ShipIt.`)) await rm(path.join(byHost, name), { force: true });
  }
}

let server: Server | undefined;
try {
  await rm(work, { recursive: true, force: true });
  await removeTestCaches();
  await mkdir(feedDir, { recursive: true });
  server = await serveFeed();
  const address = server.address();
  const feedUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const v1 = await buildVersion('0.0.1', feedUrl, []);
  const v2 = await buildVersion('0.0.2', feedUrl, [GOOD_MIGRATION]);
  const v3 = await buildVersion('0.0.3', feedUrl, [GOOD_MIGRATION, BROKEN_MIGRATION]);
  await publish(v2, v1);
  await updateCycle(v1);
  await migrationCycle(v2, v3);
} finally {
  server?.close();
  const remaining = [...runningApps];
  await Promise.all(remaining.map((running) => quit(running, 5_000)));
  await Promise.all(remaining.map((running) => running.exited));
  stopRelaunched();
  try {
    await removeTestCaches();
  } finally {
    await rm(appData, { recursive: true, force: true });
  }
}

console.log('\n[e2e] Summary');
for (const result of results) console.log(`  ${result.outcome.padEnd(8)} ${result.check}`);
if (results.some((result) => result.outcome === 'failed')) process.exit(1);
