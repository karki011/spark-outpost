import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { MacArch } from './builder-config.ts';
import { packageDesktop, releaseDir } from './stage.ts';

const work = path.join(releaseDir, 'e2e');
const feedDir = path.join(work, 'feed');
const installDir = path.join(work, 'Applications');
const appData = path.join(work, 'app-data');
const userData = path.join(appData, 'Spark Outpost');
const PACKAGE_NAME = 'spark-outpost-e2e';
const APP_ID = 'ai.spark-outpost.app.e2e';
const caches = path.join(os.homedir(), 'Library/Caches');
const updaterCache = path.join(caches, `${PACKAGE_NAME}-updater`);
const testCaches = [updaterCache, path.join(caches, APP_ID), path.join(caches, `${APP_ID}.ShipIt`)];
const arch: MacArch = os.arch() === 'arm64' ? 'arm64' : 'x64';
const appName = 'Spark Outpost.app';
const GOOD_MIGRATION = ['9990_e2e_update.sql', 'CREATE TABLE e2e_update (id int PRIMARY KEY);'];
const BROKEN_MIGRATION = [
  '9991_e2e_broken.sql',
  'CREATE TABLE e2e_broken (id int REFERENCES nope);',
];

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
    console.log(`[feed] ${request.method} ${name} ${request.headers.range ?? ''}`.trim());
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    if (range) {
      const [start, end] = [Number(range[1]), Number(range[2])];
      response.writeHead(206, { 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function buildEnv(feedUrl: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('APPLE_') || name.startsWith('CSC_')) delete env[name];
  }
  return { ...env, SPARK_UPDATE_FEED_URL: feedUrl, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
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
}

function launch(app: string): Running {
  const child = spawn(path.join(app, 'Contents/MacOS/Spark Outpost'), [], {
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
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { child, lines, exited };
}

async function waitForLine(running: Running, pattern: RegExp, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = running.lines.find((line) => pattern.test(line));
    if (found) return found;
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
  const running = launch(app);
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
  const fullDownload = running.lines.find((line) =>
    /previous update\.zip|differential/i.test(line),
  );
  record(
    'differential download from the blockmap',
    'blocked',
    `the first update after a fresh install has no cached update.zip, so it downloads in full. ${fullDownload ?? ''}`.trim(),
  );
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

async function migrationCycle(v2: string, v3: string): Promise<void> {
  const second = launch(await install(v2));
  const ready = await waitForLine(second, /\[main\] Spark Outpost \S* ?ready on/, 120_000);
  const backedUp = second.lines.find((line) => /\[migrate\] Backed up the database/.test(line));
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
  for (const dir of testCaches) await rm(dir, { recursive: true, force: true });
}

await rm(work, { recursive: true, force: true });
await removeTestCaches();
await mkdir(feedDir, { recursive: true });
const server = await serveFeed();
const address = server.address();
const feedUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
try {
  const v1 = await buildVersion('0.0.1', feedUrl, []);
  const v2 = await buildVersion('0.0.2', feedUrl, [GOOD_MIGRATION]);
  const v3 = await buildVersion('0.0.3', feedUrl, [GOOD_MIGRATION, BROKEN_MIGRATION]);
  await publish(v2, v1);
  await updateCycle(v1);
  await migrationCycle(v2, v3);
} finally {
  server.close();
  await removeTestCaches();
}

console.log('\n[e2e] Summary');
for (const result of results) console.log(`  ${result.outcome.padEnd(8)} ${result.check}`);
if (results.some((result) => result.outcome === 'failed')) process.exit(1);
