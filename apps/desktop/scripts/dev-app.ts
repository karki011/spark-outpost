import { createHash } from 'node:crypto';
import path from 'node:path';

export const DEV_APP_NAME = 'Spark Outpost Dev';
export const DEV_APP_ID = 'com.sparkoutpost.dev';
export const DEFAULT_DEBUG_PORT = 9333;

const USAGE_STRINGS: [string, string][] = [
  [
    'NSMicrophoneUsageDescription',
    'Spark Outpost Dev listens only while you press the Voice shortcut or the mic button, or while a meeting you started is recording, and turns your speech into text on this Mac.',
  ],
  [
    'NSAudioCaptureUsageDescription',
    'Spark Outpost Dev hears what your Mac plays only while a meeting you started is recording, and turns it into text on this Mac. The audio is never saved.',
  ],
  [
    'NSSpeechRecognitionUsageDescription',
    'Spark Outpost Dev turns your speech into text on this Mac when you use Voice.',
  ],
  [
    'NSCalendarsFullAccessUsageDescription',
    'Spark Outpost Dev reads your calendar to show your upcoming meetings.',
  ],
  [
    'NSAppleEventsUsageDescription',
    'Spark Outpost Dev asks other apps for information only when you use Mac control.',
  ],
];

export const DEV_ENTITLEMENTS = [
  'com.apple.security.device.audio-input',
  'com.apple.security.personal-information.calendars',
  'com.apple.security.automation.apple-events',
];

export type SigningIdentity =
  { kind: 'developer-id'; sign: string; label: string } | { kind: 'ad-hoc' };

const DEVELOPER_ID_LINE = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(Developer ID Application: [^"]+)"/;

export function pickIdentity(
  env: Record<string, string | undefined>,
  findIdentity: () => Promise<string>,
): Promise<SigningIdentity> {
  const named = env.CSC_NAME?.trim();
  if (named) return Promise.resolve({ kind: 'developer-id', sign: named, label: named });
  return findIdentity().then((output) => {
    for (const line of output.split('\n')) {
      const match = DEVELOPER_ID_LINE.exec(line);
      if (match) return { kind: 'developer-id', sign: match[1]!, label: match[2]! };
    }
    return { kind: 'ad-hoc' };
  });
}

export function codesignIdentity(identity: SigningIdentity): string {
  return identity.kind === 'ad-hoc' ? '-' : identity.sign;
}

export function infoPlistEdits(): [string, string][] {
  return [
    ['CFBundleIdentifier', DEV_APP_ID],
    ['CFBundleName', DEV_APP_NAME],
    ['CFBundleDisplayName', DEV_APP_NAME],
    ...USAGE_STRINGS,
  ];
}

export async function setInfoPlist(run: Run, plist: string, edits: [string, string][]) {
  for (const [key, value] of edits) {
    await run('plutil', ['-insert', key, '-string', value, plist]).catch(() =>
      run('plutil', ['-replace', key, '-string', value, plist]),
    );
  }
}

export function withEntitlements(baseXml: string, keys: string[]): string {
  const added = keys
    .filter((key) => !baseXml.includes(`<key>${key}</key>`))
    .map((key) => `    <key>${key}</key>\n    <true/>\n`)
    .join('');
  const end = baseXml.lastIndexOf('</dict>');
  if (end === -1) throw new Error('The base entitlements file has no <dict>.');
  return `${baseXml.slice(0, end).trimEnd()}\n${added}  ${baseXml.slice(end)}`;
}

export function codesignArgs(app: string, entitlements: string, identity: SigningIdentity) {
  return [
    '--force',
    '--deep',
    '--options',
    'runtime',
    '--timestamp=none',
    '--entitlements',
    entitlements,
    '--sign',
    codesignIdentity(identity),
    app,
  ];
}

export interface OpenOptions {
  app: string;
  appDir: string;
  port: number | null;
  dataDir?: string | undefined;
  passEnv?: Record<string, string | undefined>;
}

export const PASSED_ENV = [
  'SPARK_CALENDAR_SEED',
  'SPARK_CALENDAR_SEED_STATE',
  'SPARK_CALENDAR_SEED_ONE',
  'SPARK_FAKE_ASSISTIVE',
  'SPARK_FAKE_OPEN_EXTERNAL',
  'SPARK_TEST_LIVE_SESSION_IDLE_MS',
  'SPARK_VOICE_FILE_INPUT',
] as const;

function envArgs(options: OpenOptions): string[] {
  const data = options.dataDir ? [`SPARK_APP_DATA=${options.dataDir}`] : [];
  const passed = PASSED_ENV.flatMap((name) => {
    const value = options.passEnv?.[name];
    return value ? [`${name}=${value}`] : [];
  });
  return [...data, ...passed].flatMap((entry) => ['--env', entry]);
}

export function openArgs(options: OpenOptions): string[] {
  const env = envArgs(options);
  const debug = options.port === null ? [] : [`--remote-debugging-port=${options.port}`];
  return ['-W', '-n', '-a', options.app, ...env, '--args', options.appDir, ...debug];
}

export const DEBUG_PORT_WARNING =
  'The debug port is on: any process on this Mac can drive Spark Outpost Dev through it and use its macOS permissions (Accessibility, Microphone, Input Monitoring, Calendar). Leave out --port and --debug unless a test needs it.';

export function parsePort(value: string | undefined, debug: boolean): number | null {
  if (value === undefined) return debug ? DEFAULT_DEBUG_PORT : null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`--port must be a whole number from 1024 to 65535, not "${value}".`);
  return port;
}

export function devAppBinary(app: string): string {
  return path.join(app, 'Contents/MacOS/Electron');
}

const DEBUG_PORT_ARG = / --remote-debugging-port=\d+$/;

export function launchedFrom(psOutput: string, binary: string, launchDir: string): number[] {
  const pids: number[] = [];
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+) (.*)$/.exec(line);
    if (!match || !match[2]!.startsWith(`${binary} `)) continue;
    const appDir = match[2]!.slice(binary.length + 1).replace(DEBUG_PORT_ARG, '');
    if (appDir === launchDir) pids.push(Number(match[1]));
  }
  return pids;
}

export function stopRefusal(pids: number[], launchDir: string): string | null {
  if (pids.length === 1) return null;
  if (pids.length === 0) return `no running copy was launched from ${launchDir}`;
  return `${pids.length} running copies were launched from ${launchDir}, so none is stopped`;
}

export interface InterruptDeps {
  launchDir: string;
  findOurs: () => Promise<number[]>;
  terminate: (pid: number) => void;
  waitForExit: (timeoutMs: number) => Promise<boolean>;
  removeLink: () => Promise<void>;
  log: (line: string) => void;
}

export const QUIT_TIMEOUT_MS = 30_000;

export async function stopOnInterrupt(link: string | null, deps: InterruptDeps): Promise<void> {
  const kept = link ? ` Its launch link stays at ${link}; remove it after quitting.` : '';
  const pids = await deps.findOurs().catch(() => []);
  const refusal = stopRefusal(pids, deps.launchDir);
  if (refusal) {
    deps.log(`Not stopping ${DEV_APP_NAME}: ${refusal}.${kept}`);
    return;
  }
  deps.terminate(pids[0]!);
  if (await deps.waitForExit(QUIT_TIMEOUT_MS)) {
    await deps.removeLink();
    return;
  }
  deps.log(`${DEV_APP_NAME} is still running.${kept}`);
}

function hasDotFolder(dir: string): boolean {
  return dir.split(path.sep).some((part) => part.startsWith('.') && part !== '.');
}

export interface AppDirPlan {
  launchDir: string;
  link: { path: string; target: string } | null;
}

export function appDirPlan(appDir: string, tmpRoot: string): AppDirPlan {
  const repoRoot = path.resolve(appDir, '../..');
  if (!hasDotFolder(repoRoot)) return { launchDir: appDir, link: null };
  const name = `spark-dev-app-${createHash('sha256').update(repoRoot).digest('hex').slice(0, 12)}`;
  const link = path.join(tmpRoot, name);
  return { launchDir: path.join(link, 'apps/desktop'), link: { path: link, target: repoRoot } };
}

export function desktopDir(dir: string, exists: (file: string) => boolean): string {
  const nested = path.join(dir, 'apps/desktop');
  return exists(path.join(nested, 'package.json')) ? nested : dir;
}

export function missingPrerequisites(
  appDir: string,
  arch: string,
  exists: (file: string) => boolean,
): { missing: string[]; warnings: string[] } {
  const repoRoot = path.resolve(appDir, '../..');
  const missing = [
    path.join(appDir, 'dist/main.js'),
    path.join(repoRoot, 'apps/web/dist/index.html'),
  ].filter((file) => !exists(file));
  const helper = path.join(repoRoot, '.local/mac-control', arch, 'spark-mac-control');
  const addon = path.join(repoRoot, '.local/no-activate', arch, 'no-activate.node');
  const warnings = [
    ...(exists(helper)
      ? []
      : [
          `No Mac control helper at ${helper}; run pnpm desktop:mac-control there to use Mac control.`,
        ]),
    ...(exists(addon)
      ? []
      : [
          `No no-activate addon at ${addon}; run pnpm desktop:no-activate there, or clicks on Spark Island bring Spark forward.`,
        ]),
  ];
  return { missing, warnings };
}

export function designatedRequirement(codesignOutput: string): string | null {
  const line = codesignOutput.split('\n').find((entry) => entry.startsWith('designated => '));
  return line ? line.slice('designated => '.length).trim() : null;
}

export interface Run {
  (command: string, args: string[]): Promise<string>;
}

export interface DevAppDeps {
  run: Run;
  readText: (file: string) => Promise<string | null>;
  writeText: (file: string, text: string) => Promise<void>;
  remove: (file: string) => Promise<void>;
  makeDir: (dir: string) => Promise<void>;
  log: (line: string) => void;
}

export interface DevAppSource {
  electronApp: string;
  electronVersion: string;
  baseEntitlements: string;
  devDir: string;
  identity: SigningIdentity;
}

export interface DevAppResult {
  app: string;
  reused: boolean;
  requirement: string | null;
}

export function devAppPath(devDir: string): string {
  return path.join(devDir, `${DEV_APP_NAME}.app`);
}

function stampText(source: DevAppSource, baseEntitlements: string): string {
  return JSON.stringify({
    electronVersion: source.electronVersion,
    identity: codesignIdentity(source.identity),
    info: infoPlistEdits(),
    entitlements: [baseEntitlements, ...DEV_ENTITLEMENTS],
  });
}

async function isValid(deps: DevAppDeps, app: string): Promise<boolean> {
  return deps.run('codesign', ['--verify', '--deep', '--strict', app]).then(
    () => true,
    () => false,
  );
}

async function buildCopy(source: DevAppSource, deps: DevAppDeps, app: string, base: string) {
  const entitlements = path.join(source.devDir, 'entitlements.plist');
  await deps.remove(app);
  await deps.makeDir(source.devDir);
  deps.log(`Copying Electron ${source.electronVersion} to ${app}.`);
  await deps.run('ditto', [source.electronApp, app]);
  await deps.run('xattr', ['-cr', app]);
  const plist = path.join(app, 'Contents/Info.plist');
  await setInfoPlist(deps.run, plist, infoPlistEdits());
  await deps.writeText(entitlements, withEntitlements(base, DEV_ENTITLEMENTS));
  await deps.run('plutil', ['-lint', entitlements]);
  deps.log(`Signing with ${identityLabel(source.identity)}.`);
  await deps.run('codesign', codesignArgs(app, entitlements, source.identity));
  await deps.run('codesign', ['--verify', '--deep', '--strict', app]);
}

export function identityLabel(identity: SigningIdentity): string {
  return identity.kind === 'ad-hoc' ? 'an ad hoc signature' : identity.label;
}

export async function prepareDevApp(source: DevAppSource, deps: DevAppDeps): Promise<DevAppResult> {
  const app = devAppPath(source.devDir);
  const stampFile = path.join(source.devDir, 'stamp.json');
  const base = await deps.readText(source.baseEntitlements);
  if (base === null) throw new Error(`No entitlements file at ${source.baseEntitlements}.`);
  const stamp = stampText(source, base);
  const reused = (await deps.readText(stampFile)) === stamp && (await isValid(deps, app));
  if (!reused) {
    await deps.remove(stampFile);
    await buildCopy(source, deps, app, base);
    await deps.writeText(stampFile, stamp);
  }
  const requirement = designatedRequirement(await deps.run('codesign', ['-d', '-r-', app]));
  return { app, reused, requirement };
}
