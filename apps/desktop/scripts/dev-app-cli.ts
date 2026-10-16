import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import {
  appDirPlan,
  DEV_APP_NAME,
  desktopDir,
  identityLabel,
  missingPrerequisites,
  openArgs,
  parsePort,
  pickIdentity,
  prepareDevApp,
  type DevAppDeps,
} from './dev-app.ts';

const execFileAsync = promisify(execFile);
const checkoutRoot = path.resolve(import.meta.dirname, '../../..');
const callerDir = process.env.INIT_CWD ?? process.cwd();

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    port: { type: 'string' },
    'app-dir': { type: 'string' },
  },
});

async function run(command: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 });
  return `${stdout}${stderr}`;
}

const deps: DevAppDeps = {
  run,
  readText: (file) => readFile(file, 'utf8').catch(() => null),
  writeText: (file, text) => writeFile(file, text),
  remove: (file) => rm(file, { recursive: true, force: true }),
  makeDir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  log: (line) => console.log(line),
};

function installedElectron(): { app: string; version: string } {
  const require = createRequire(path.join(checkoutRoot, 'apps/desktop/package.json'));
  const binary = require('electron') as string;
  const { version } = require('electron/package.json') as { version: string };
  return { app: path.resolve(binary, '../../..'), version };
}

async function mainCheckout(): Promise<string> {
  const common = await run('git', [
    '-C',
    checkoutRoot,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  return path.dirname(common.trim());
}

async function answers(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(1000) }).then(
    (response) => response.ok,
    () => false,
  );
}

async function pageUrls(port: number): Promise<string[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = (await response.json()) as { type?: string; url?: string }[];
  return targets.filter((target) => target.type === 'page').map((target) => target.url ?? '');
}

async function waitForDebugPort(port: number, exited: () => boolean): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !exited()) {
    if (await answers(`http://127.0.0.1:${port}/json/version`)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${DEV_APP_NAME} did not open its debug port ${port}.`);
}

async function linkAppDir(link: { path: string; target: string }): Promise<void> {
  await rm(link.path, { force: true });
  await symlink(link.target, link.path);
}

const port = parsePort(values.port);
const appDir = desktopDir(path.resolve(callerDir, values['app-dir'] ?? checkoutRoot), existsSync);
const dataDir = values.data ? path.resolve(callerDir, values.data) : undefined;

const prerequisites = missingPrerequisites(appDir, process.arch, existsSync);
for (const warning of prerequisites.warnings) console.warn(warning);
if (prerequisites.missing.length > 0) {
  const root = path.resolve(appDir, '../..');
  throw new Error(
    `Missing ${prerequisites.missing.join(', ')}. In ${root} run: pnpm --filter @spark-outpost/web build && pnpm --filter @spark-outpost/desktop build`,
  );
}
if (await answers(`http://127.0.0.1:${port}/json/version`))
  throw new Error(`Port ${port} already answers. Quit the app using it or pass --port.`);

const electron = installedElectron();
const identity = await pickIdentity(process.env, () =>
  run('security', ['find-identity', '-v', '-p', 'codesigning']),
);
if (identity.kind === 'ad-hoc')
  console.warn(
    'No Developer ID Application identity found and CSC_NAME is not set. Signing ad hoc: macOS permission grants will not persist when the app is rebuilt.',
  );
const result = await prepareDevApp(
  {
    electronApp: electron.app,
    electronVersion: electron.version,
    baseEntitlements: path.join(checkoutRoot, 'apps/desktop/build/entitlements.mac.plist'),
    devDir: path.join(await mainCheckout(), '.local/dev-app'),
    identity,
  },
  deps,
);
console.log(
  `${result.reused ? 'Reusing' : 'Built'} ${result.app} (Electron ${electron.version}, ${identityLabel(identity)}).`,
);
console.log(`Designated requirement: ${result.requirement ?? 'none'}`);

const plan = appDirPlan(appDir, '/private/tmp');
if (plan.link) {
  await linkAppDir(plan.link);
  console.log(
    `${plan.link.target} has a dot folder in its path; launching through ${plan.link.path}.`,
  );
}
const removeLink = () => (plan.link ? rm(plan.link.path, { force: true }) : Promise.resolve());

let exited = false;
const child = spawn('open', openArgs({ app: result.app, appDir: plan.launchDir, port, dataDir }), {
  stdio: 'inherit',
});
const exit = new Promise<void>((resolve) =>
  child.once('exit', () => {
    exited = true;
    resolve();
  }),
);
process.once('SIGINT', () => {
  void removeLink().then(() => process.exit(130));
});

try {
  await waitForDebugPort(port, () => exited);
  console.log(`${DEV_APP_NAME} is running. DevTools: http://127.0.0.1:${port}`);
  for (const url of await pageUrls(port)) console.log(`Page: ${url}`);
  console.log(`Quit the app to end this command.`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
await exit;
await removeLink();
